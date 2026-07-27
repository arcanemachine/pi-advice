import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import piAdvice from "../src/index.js";

describe("extension command registration", () => {
  it("registers only /advise and /advise-every", () => {
    const commands = new Map<string, unknown>();
    const pi = {
      registerCommand: (name: string, definition: unknown) => {
        commands.set(name, definition);
      },
      on: () => undefined,
    } as unknown as ExtensionAPI;

    piAdvice(pi);

    expect([...commands.keys()]).toEqual(["advise", "advise-every"]);
    expect(commands.has("advice")).toBe(false);
    expect(commands.has("advice-every")).toBe(false);
  });
});
