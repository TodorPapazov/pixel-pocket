import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REGISTRATION_NOT_SAVED,
  isLiveAuthServer,
  registrationStorageError,
} from "./registration-storage.ts";

describe("registration storage", () => {
  it("treats Vercel and production as the live server", () => {
    assert.equal(isLiveAuthServer({ VERCEL: "1" }), true);
    assert.equal(isLiveAuthServer({ NODE_ENV: "production" }), true);
    assert.equal(isLiveAuthServer({ NODE_ENV: "development" }), false);
    assert.equal(isLiveAuthServer({}), false);
  });

  it("refuses the live server when no shared database is configured", () => {
    assert.equal(
      registrationStorageError({ databaseUrl: undefined, liveServer: true }),
      REGISTRATION_NOT_SAVED,
    );
    assert.equal(
      registrationStorageError({ databaseUrl: "   ", liveServer: true }),
      REGISTRATION_NOT_SAVED,
    );
  });

  it("allows a configured database, and local dev without one", () => {
    assert.equal(
      registrationStorageError({
        databaseUrl: "postgres://db.example/app",
        liveServer: true,
      }),
      null,
    );
    assert.equal(
      registrationStorageError({ databaseUrl: undefined, liveServer: false }),
      null,
    );
  });
});
