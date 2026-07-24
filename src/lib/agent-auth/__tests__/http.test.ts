import {
  AgentAuthError,
  AgentValidationError,
} from "../service";
import { agentAuthErrorResponse } from "../http";

it("maps durable pairing limits to HTTP 429 with Retry-After", async () => {
  const response = agentAuthErrorResponse(
    new AgentAuthError(
      "PAIRING_RATE_LIMITED",
      "Too many pairing attempts.",
      61_001,
    ),
  );

  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("62");
  expect(await response.json()).toMatchObject({
    code: "PAIRING_RATE_LIMITED",
  });
});

it("exposes only deliberate validation failures", async () => {
  const validationResponse = agentAuthErrorResponse(
    new AgentValidationError("Key name must be between 1 and 120 characters."),
  );

  expect(validationResponse.status).toBe(400);
  expect(await validationResponse.json()).toMatchObject({
    error: "Key name must be between 1 and 120 characters.",
  });
  expect(() =>
    agentAuthErrorResponse(new TypeError("internal programmer detail")),
  ).toThrow("internal programmer detail");
});
