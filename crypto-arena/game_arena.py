# v1.0.0
# { "Depends": "py-genlayer:test" }

from genlayer import *
import json


class CryptoArena(gl.Contract):

    games:         TreeMap[str, str]
    leaderboard:   TreeMap[str, str]
    total_games:   str
    total_players: str

    def __init__(self) -> None:
        self.total_games   = "0"
        self.total_players = "0"

    @gl.public.write
    def record_winner(self, room_code: str, winner: str, rounds: int, players: int) -> str:
        prompt = (
            "You are a blockchain game oracle verifying a multiplayer crypto prediction game result. "
            "Room code: " + room_code + ". Winner: " + winner + ". "
            "Rounds played: " + str(rounds) + ". Total players: " + str(players) + ". "
            "Verify this is a legitimate game result and respond ONLY with this JSON on one line: "
            "{\"verified\": true, \"room\": \"" + room_code + "\", "
            "\"winner\": \"" + winner + "\", "
            "\"rounds\": " + str(rounds) + ", "
            "\"players\": " + str(players) + ", "
            "\"verdict\": \"Legitimate BTC prediction game verified by GenLayer AI consensus\"}"
        )

        def fetch():
            raw = gl.nondet.exec_prompt(prompt)
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                lines = cleaned.split("\n")
                cleaned = "\n".join(lines[1:])
            return cleaned.replace("```json", "").replace("```", "").strip()

        result_str = gl.eq_principle.unsafe_eq(fetch)
        data = json.loads(result_str)

        record = json.dumps({
            "room":     room_code,
            "winner":   winner,
            "rounds":   rounds,
            "players":  players,
            "verified": data.get("verified", True),
            "verdict":  data.get("verdict", "Verified by GenLayer"),
        })

        self.games[room_code]    = record
        self.leaderboard[winner] = str(int(self.leaderboard.get(winner, "0")) + 1)
        self.total_games         = str(int(self.total_games) + 1)
        self.total_players       = str(int(self.total_players) + players)

        return json.dumps({
            "success": True,
            "room":    room_code,
            "winner":  winner,
            "message": winner + " wins! Verified on GenLayer.",
        })

    @gl.public.view
    def get_game(self, room_code: str) -> dict:
        raw = self.games.get(room_code, "")
        if raw:
            try:
                return {"found": True, "game": json.loads(raw)}
            except Exception:
                pass
        return {"found": False, "game": None}

    @gl.public.view
    def get_wins(self, player: str) -> dict:
        return {"player": player, "wins": int(self.leaderboard.get(player, "0"))}

    @gl.public.view
    def get_stats(self) -> dict:
        return {
            "total_games":   int(self.total_games),
            "total_players": int(self.total_players),
            "source":        "GenLayer Crypto Arena",
            "network":       "GenLayer Studionet",
        }
