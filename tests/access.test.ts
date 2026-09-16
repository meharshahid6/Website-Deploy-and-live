import { it, expect, vi, afterEach } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { authorize } from "../worker/security";
import type { AppEnv } from "../worker/env";
afterEach(() => vi.unstubAllGlobals());
it("validates signed Access identity, issuer, audience, expiry and cached keys", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "RS256",
  };
  const fetchMock = vi.fn(async () => Response.json({ keys: [jwk] }));
  vi.stubGlobal("fetch", fetchMock);
  const env = {
    LOCAL_DEV: "false",
    ACCESS_TEAM_DOMAIN: "signed-test.cloudflareaccess.com",
    ACCESS_AUD: "launchdock",
    OWNER_EMAIL: "owner@example.com",
  } as AppEnv;
  const token = (
    email = "owner@example.com",
    aud = "launchdock",
    exp = "5m",
    issuer = "https://signed-test.cloudflareaccess.com",
  ) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(aud)
      .setExpirationTime(exp)
      .sign(privateKey);
  const request = (jwt: string) =>
    new Request("https://dashboard.example.com/api/projects", {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
  expect(await authorize(request(await token()), env)).toBe(
    "owner@example.com",
  );
  expect(await authorize(request(await token()), env)).toBe(
    "owner@example.com",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  for (const jwt of [
    await token("other@example.com"),
    await token(undefined, "wrong-audience"),
    await token(undefined, undefined, "-1s"),
    await token(
      undefined,
      undefined,
      undefined,
      "https://wrong.cloudflareaccess.com",
    ),
  ])
    await expect(authorize(request(jwt), env)).rejects.toMatchObject({
      status: 403,
    });
});
