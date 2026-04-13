# v1.4.0
# { "Depends": "py-genlayer:test" }

from genlayer import *
import json


class PriceFeedOracle(gl.Contract):

    price_snapshots: TreeMap[str, str]
    snapshot_counts: TreeMap[str, str]
    latest_price:    TreeMap[str, str]
    tracked_symbols: str
    total_queries:   str

    def __init__(self) -> None:
        self.tracked_symbols = ""
        self.total_queries   = "0"

    def _split(self, value: str) -> list:
        if not value:
            return []
        return [x for x in value.split(",") if x]

    def _symbol(self, coin_id: str) -> str:
        m = {
            "bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL",
            "binancecoin": "BNB", "cardano": "ADA", "polkadot": "DOT",
            "chainlink": "LINK", "ripple": "XRP", "litecoin": "LTC",
            "avalanche-2": "AVAX", "uniswap": "UNI", "dogecoin": "DOGE",
            "shiba-inu": "SHIB", "pepe": "PEPE", "tron": "TRX",
            "near": "NEAR", "aptos": "APT", "sui": "SUI",
        }
        return m.get(coin_id, coin_id.upper()[:6])

    def _clean(self, raw: str) -> str:
        raw = raw.strip()
        if raw.startswith("```"):
            lines = raw.split("\n")
            raw = "\n".join(lines[1:])
        raw = raw.replace("```json", "").replace("```", "").strip()
        return raw

    @gl.public.write
    def get_price(self, coin_id: str) -> str:
        coin_id = coin_id.lower().strip()
        sym = self._symbol(coin_id)

        # NOTE: do NOT read self.* inside nondet - causes storage error
        # All state reads/writes happen AFTER the nondet call

        prompt = (
            "You are a cryptocurrency price oracle. "
            "Based on your training data and best knowledge, "
            "what is a realistic current approximate price for "
            + coin_id + " (" + sym + ") in USD? "
            "Give your best estimate even if you are uncertain. "
            "Respond with ONLY this JSON on one line, no markdown, no explanation: "
            "{\"success\": true, \"coin_id\": \"" + coin_id + "\", "
            "\"symbol\": \"" + sym + "\", "
            "\"usd\": 95000.00, \"change_24h\": 1.25, "
            "\"source\": \"GenLayer AI Oracle\", "
            "\"verified_by\": \"GenLayer Consensus\"}"
        )

        # Run AI call - no state access inside here
        def fetch():
            raw = gl.nondet.exec_prompt(prompt)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                cleaned = "\n".join(lines[1:])
            cleaned = cleaned.replace("```json", "").replace("```", "").strip()
            return cleaned

        result_str = gl.eq_principle.strict_eq(fetch)
        data = json.loads(result_str)

        # State writes happen AFTER nondet
        count = int(self.total_queries)
        self.total_queries = str(count + 1)

        known = self._split(self.tracked_symbols)
        if coin_id not in known:
            known.append(coin_id)
            self.tracked_symbols = ",".join(known)

        self.latest_price[coin_id] = str(data.get("usd", 0))

        return json.dumps(data)

    @gl.public.write
    def get_prices(self, coin_ids_csv: str) -> str:
        coins = [c.strip().lower() for c in coin_ids_csv.split(",") if c.strip()][:6]
        coin_list = ", ".join(coins)

        prompt = (
            "You are a cryptocurrency price oracle. "
            "Based on your training data, give realistic approximate prices for: " + coin_list + ". "
            "Respond with ONLY this JSON on one line, no markdown: "
            "{\"prices\": [{\"coin_id\": \"bitcoin\", \"symbol\": \"BTC\", \"usd\": 95000.0, \"change_24h\": 1.25}]}"
        )

        def fetch():
            raw = gl.nondet.exec_prompt(prompt)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                cleaned = "\n".join(lines[1:])
            cleaned = cleaned.replace("```json", "").replace("```", "").strip()
            return cleaned

        result_str = gl.eq_principle.strict_eq(fetch)
        data = json.loads(result_str)
        prices = data.get("prices", [])

        self.total_queries = str(int(self.total_queries) + 1)

        return json.dumps({
            "success": True,
            "prices": prices,
            "count": len(prices),
            "verified_by": "GenLayer Consensus",
        })

    @gl.public.write
    def record_price(self, coin_id: str) -> str:
        coin_id = coin_id.lower().strip()
        sym = self._symbol(coin_id)

        prompt = (
            "You are a cryptocurrency price oracle. "
            "Based on your training data, give a realistic approximate price for "
            + coin_id + " (" + sym + ") in USD. "
            "Respond with ONLY this JSON on one line, no markdown: "
            "{\"usd\": 95000.00, \"change_24h\": 1.25}"
        )

        def fetch():
            raw = gl.nondet.exec_prompt(prompt)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                cleaned = "\n".join(lines[1:])
            cleaned = cleaned.replace("```json", "").replace("```", "").strip()
            return cleaned

        result_str = gl.eq_principle.strict_eq(fetch)
        cd = json.loads(result_str)

        price_usd  = float(cd.get("usd", 0))
        change_24h = round(float(cd.get("change_24h", 0)), 2)

        # All state writes after nondet
        count    = int(self.snapshot_counts.get(coin_id, "0"))
        snap_key = coin_id + ":" + str(count)
        snapshot = json.dumps({
            "price_usd":      price_usd,
            "change_24h":     change_24h,
            "symbol":         sym,
            "snapshot_index": count,
        })

        self.price_snapshots[snap_key]  = snapshot
        self.snapshot_counts[coin_id]   = str(count + 1)
        self.latest_price[coin_id]      = str(price_usd)
        self.total_queries              = str(int(self.total_queries) + 1)

        known = self._split(self.tracked_symbols)
        if coin_id not in known:
            known.append(coin_id)
            self.tracked_symbols = ",".join(known)

        return json.dumps({
            "success":         True,
            "coin_id":         coin_id,
            "symbol":          sym,
            "price_usd":       price_usd,
            "change_24h":      change_24h,
            "snapshot_index":  count,
            "stored_on_chain": True,
            "verified_by":     "GenLayer Consensus",
        })

    @gl.public.view
    def get_price_history(self, coin_id: str) -> dict:
        coin_id = coin_id.lower().strip()
        count   = int(self.snapshot_counts.get(coin_id, "0"))
        if count == 0:
            return {"coin_id": coin_id, "snapshots": [], "count": 0}
        snapshots = []
        for i in range(count):
            key = coin_id + ":" + str(i)
            raw = self.price_snapshots.get(key, "")
            if raw:
                try:
                    snapshots.append(json.loads(raw))
                except Exception:
                    pass
        return {
            "coin_id":          coin_id,
            "latest_price_usd": float(self.latest_price.get(coin_id, "0")),
            "snapshots":        snapshots,
            "count":            len(snapshots),
        }

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "total_queries": int(self.total_queries),
            "tracked_coins": len(self._split(self.tracked_symbols)),
            "source":        "GenLayer AI Oracle",
            "network":       "GenLayer Studionet",
        }
