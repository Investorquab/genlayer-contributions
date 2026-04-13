# v1.0.0
# { "Depends": "py-genlayer:test" }

from genlayer import *
import json


class PredictionMarket(gl.Contract):

    markets:       TreeMap[str, str]
    bets:          TreeMap[str, str]
    user_balances: TreeMap[str, str]
    total_markets: str

    def __init__(self) -> None:
        self.total_markets = "0"

    # ── CREATE MARKET ─────────────────────────────
    @gl.public.write
    def create_market(
        self,
        question:  str,
        deadline:  str,
        category:  str,
        creator:   str,
    ) -> str:
        market_id = "M" + str(int(self.total_markets) + 1)

        market = {
            "id":         market_id,
            "question":   question,
            "deadline":   deadline,
            "category":   category,
            "creator":    creator,
            "status":     "open",
            "yes_pool":   "0",
            "no_pool":    "0",
            "outcome":    "",
            "reasoning":  "",
            "total_bets": "0",
        }

        self.markets[market_id] = json.dumps(market)
        self.total_markets = str(int(self.total_markets) + 1)

        return json.dumps({
            "success":   True,
            "market_id": market_id,
            "question":  question,
            "message":   "Market " + market_id + " created!",
        })

    # ── PLACE BET ────────────────────────────────
    @gl.public.write
    def place_bet(
        self,
        market_id: str,
        side:      str,
        amount:    int,
        user:      str,
    ) -> str:
        raw = self.markets.get(market_id, "")
        if not raw:
            return json.dumps({"success": False, "error": "Market not found"})

        market = json.loads(raw)

        if market["status"] != "open":
            return json.dumps({"success": False, "error": "Market is not open"})

        if side not in ["YES", "NO"]:
            return json.dumps({"success": False, "error": "Side must be YES or NO"})

        if amount <= 0:
            return json.dumps({"success": False, "error": "Amount must be positive"})

        # Update pool
        if side == "YES":
            market["yes_pool"] = str(int(market["yes_pool"]) + amount)
        else:
            market["no_pool"] = str(int(market["no_pool"]) + amount)

        market["total_bets"] = str(int(market["total_bets"]) + 1)
        self.markets[market_id] = json.dumps(market)

        # Record bet
        bet_key = market_id + ":" + user + ":" + str(int(market["total_bets"]))
        bet = {
            "market_id": market_id,
            "user":      user,
            "side":      side,
            "amount":    amount,
        }
        self.bets[bet_key] = json.dumps(bet)

        return json.dumps({
            "success":   True,
            "market_id": market_id,
            "side":      side,
            "amount":    amount,
            "yes_pool":  market["yes_pool"],
            "no_pool":   market["no_pool"],
        })

    # ── RESOLVE MARKET (AI consensus) ────────────
    @gl.public.write
    def resolve_market(self, market_id: str) -> str:
        raw = self.markets.get(market_id, "")
        if not raw:
            return json.dumps({"success": False, "error": "Market not found"})

        market = json.loads(raw)

        if market["status"] != "open":
            return json.dumps({"success": False, "error": "Market already resolved"})

        question  = market["question"]
        deadline  = market["deadline"]
        yes_pool  = int(market["yes_pool"])
        no_pool   = int(market["no_pool"])
        total     = yes_pool + no_pool

        prompt = (
            "You are a prediction market resolver. Your job is to determine the outcome "
            "of a prediction market question based on real-world facts. "
            "The question was: '" + question + "'. "
            "The deadline was: " + deadline + ". "
            "Based on publicly available information and your knowledge, "
            "has this event occurred or is the statement true as of the deadline? "
            "If the deadline has not yet passed or you cannot determine the outcome with "
            "reasonable confidence, set resolved to false. "
            "Respond ONLY with this exact JSON on one line: "
            "{\"resolved\": true or false, "
            "\"outcome\": \"YES\" or \"NO\" or \"UNRESOLVED\", "
            "\"reasoning\": \"1-2 sentence explanation of your determination\", "
            "\"confidence\": \"HIGH\" or \"MEDIUM\" or \"LOW\"}"
        )

        def fetch():
            raw_result = gl.nondet.exec_prompt(prompt)
            cleaned = raw_result.strip()
            if "```" in cleaned:
                lines = cleaned.split("\n")
                cleaned = "\n".join(
                    l for l in lines
                    if not l.strip().startswith("```")
                )
            return cleaned.strip()

        result_str = gl.eq_principle.unsafe_eq(fetch)
        data       = json.loads(result_str)

        if not data.get("resolved", False):
            return json.dumps({
                "success":   False,
                "error":     "Market could not be resolved yet",
                "reasoning": data.get("reasoning", ""),
            })

        outcome   = data.get("outcome", "UNRESOLVED")
        reasoning = data.get("reasoning", "")
        confidence = data.get("confidence", "MEDIUM")

        # Calculate payouts
        winner_pool = yes_pool if outcome == "YES" else no_pool
        loser_pool  = no_pool  if outcome == "YES" else yes_pool
        payout_ratio = str(round((total / winner_pool), 4)) if winner_pool > 0 else "0"

        market["status"]      = "resolved"
        market["outcome"]     = outcome
        market["reasoning"]   = reasoning
        market["confidence"]  = confidence
        market["payout_ratio"] = payout_ratio
        self.markets[market_id] = json.dumps(market)

        return json.dumps({
            "success":      True,
            "market_id":    market_id,
            "outcome":      outcome,
            "reasoning":    reasoning,
            "confidence":   confidence,
            "yes_pool":     yes_pool,
            "no_pool":      no_pool,
            "total_pool":   total,
            "winner_pool":  winner_pool,
            "payout_ratio": payout_ratio,
            "message":      "Market resolved: " + outcome,
        })

    # ── READ METHODS ──────────────────────────────
    @gl.public.view
    def get_market(self, market_id: str) -> dict:
        raw = self.markets.get(market_id, "")
        if raw:
            return {"found": True, "market": json.loads(raw)}
        return {"found": False, "market": None}

    @gl.public.view
    def get_all_markets(self) -> dict:
        result = []
        total  = int(self.total_markets)
        for i in range(1, total + 1):
            mid = "M" + str(i)
            raw = self.markets.get(mid, "")
            if raw:
                result.append(json.loads(raw))
        return {"markets": result, "total": total}

    @gl.public.view
    def get_stats(self) -> dict:
        total    = int(self.total_markets)
        open_c   = 0
        resolved = 0
        yes_wins = 0
        no_wins  = 0
        for i in range(1, total + 1):
            raw = self.markets.get("M" + str(i), "")
            if raw:
                m = json.loads(raw)
                if m["status"] == "open":
                    open_c += 1
                else:
                    resolved += 1
                    if m.get("outcome") == "YES":
                        yes_wins += 1
                    elif m.get("outcome") == "NO":
                        no_wins += 1
        return {
            "total_markets":    total,
            "open_markets":     open_c,
            "resolved_markets": resolved,
            "yes_outcomes":     yes_wins,
            "no_outcomes":      no_wins,
            "source":           "GenLayer Prediction Market",
        }
