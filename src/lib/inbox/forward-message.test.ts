import { describe, expect, it } from "vitest";
import { buildForwardPayload } from "./forward-message";
import type { Message } from "@/types";

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: "m1",
    conversation_id: "c1",
    sender_type: "customer",
    content_type: "text",
    status: "delivered",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildForwardPayload — location", () => {
  it("forwards a location with name + address as a native location message", () => {
    const message = makeMessage({
      content_type: "location",
      content_text: "Casa - Av. Siempre Viva 123 - -12.123456,-77.654321",
    });

    expect(buildForwardPayload(message)).toEqual({
      message_type: "location",
      latitude: -12.123456,
      longitude: -77.654321,
      location_name: "Casa",
      location_address: "Av. Siempre Viva 123",
    });
  });

  it("forwards a location with only coordinates (no name/address)", () => {
    const message = makeMessage({
      content_type: "location",
      content_text: "-12.0,-77.0",
    });

    expect(buildForwardPayload(message)).toEqual({
      message_type: "location",
      latitude: -12.0,
      longitude: -77.0,
      location_name: undefined,
      location_address: undefined,
    });
  });

  it("falls back to plain text when coordinates can't be parsed", () => {
    const message = makeMessage({
      content_type: "location",
      content_text: "Ubicación compartida (sin coordenadas)",
    });

    expect(buildForwardPayload(message)).toEqual({
      message_type: "text",
      content_text: "Ubicación compartida (sin coordenadas)",
    });
  });

  it("returns null when there's nothing to forward", () => {
    const message = makeMessage({ content_type: "location", content_text: undefined });
    expect(buildForwardPayload(message)).toBeNull();
  });
});
