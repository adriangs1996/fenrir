import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { TrafficLensReplayInput, TrafficLensReplayResponse } from "./trafficLens";

describe("TrafficLensReplayInput", () => {
  const decode = Schema.decodeUnknownSync(TrafficLensReplayInput);

  it("accepts minimal GET replay", () => {
    const input = decode({
      method: "GET",
      url: "https://target.htb/api",
      headers: { Accept: "application/json" },
    });
    expect(input.method).toBe("GET");
    expect(input.body).toBeUndefined();
  });

  it("accepts POST with body", () => {
    const input = decode({
      method: "POST",
      url: "https://target.htb/login",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: Buffer.from("user=admin").toString("base64"),
    });
    expect(input.body).toBeDefined();
  });

  it("accepts optional trafficId", () => {
    const input = decode({
      trafficId: 42,
      method: "GET",
      url: "https://target.htb/",
      headers: {},
    });
    expect(input.trafficId).toBe(42);
  });

  it("rejects missing method", () => {
    expect(() => decode({ url: "https://x.com", headers: {} })).toThrow();
  });

  it("rejects missing url", () => {
    expect(() => decode({ method: "GET", headers: {} })).toThrow();
  });
});

describe("TrafficLensReplayResponse", () => {
  const decode = Schema.decodeUnknownSync(TrafficLensReplayResponse);

  it("accepts valid response", () => {
    const resp = decode({
      statusCode: 200,
      statusText: "OK",
      headers: { "content-type": "text/html" },
      body: Buffer.from("<html>OK</html>").toString("base64"),
      timing: 150,
    });
    expect(resp.statusCode).toBe(200);
    expect(resp.timing).toBe(150);
  });

  it("accepts null body", () => {
    const resp = decode({
      statusCode: 204,
      statusText: "No Content",
      headers: {},
      body: null,
      timing: 50,
    });
    expect(resp.body).toBeNull();
  });
});
