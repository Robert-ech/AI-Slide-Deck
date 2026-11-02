import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { guardLocalMutation } from "../src/lib/local-request";

function request(url: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(url, { method: "POST", headers, body: "{}" });
}

test("local JSON writes allow same-origin browser and CLI requests", () => {
  assert.equal(guardLocalMutation(request("http://127.0.0.1:8767/api/memos", {
    origin: "http://127.0.0.1:8767", "content-type": "application/json",
  }), "json"), null);
  assert.equal(guardLocalMutation(request("http://localhost:8767/api/memos", {
    "content-type": "application/json; charset=utf-8",
  }), "json"), null);
});

test("local writes reject cross-site origins, DNS rebinding, and form content", () => {
  assert.equal(guardLocalMutation(request("http://127.0.0.1:8767/api/memos", {
    origin: "https://attacker.example", "content-type": "application/json",
  }), "json")?.status, 403);
  assert.equal(guardLocalMutation(request("http://attacker.example/api/memos", {
    origin: "http://attacker.example", "content-type": "application/json",
  }), "json")?.status, 403);
  assert.equal(guardLocalMutation(request("http://127.0.0.1:8767/api/memos", {
    "content-type": "text/plain",
  }), "json")?.status, 415);
  assert.equal(guardLocalMutation(request("http://127.0.0.1:8767/api/memos", {
    "sec-fetch-site": "cross-site", "content-type": "application/json",
  }), "json")?.status, 403);
});
