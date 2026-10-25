import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { invitationPath, loginPath, safeReturnTo } from "../lib/auth-routing";
import { canManageOrganization, initials } from "../lib/auth-types";

describe("authentication navigation", () => {
  it("rejects external, protocol-relative and executable login destinations", () => {
    for (const path of [
      "https://other.example",
      "//other.example",
      "javascript:alert(1)",
      "/\\other.example",
      "/%2f%2fother.example",
      "/api/auth/sign-out",
      "/login",
      "/unknown",
    ]) {
      assert.equal(safeReturnTo(path), "/", path);
    }
  });
  it("preserves legitimate workspace and invitation destinations", () => {
    assert.equal(safeReturnTo("/dashboard"), "/dashboard");
    assert.equal(safeReturnTo("/room-id=launch"), "/room-id=launch");
    assert.equal(
      safeReturnTo("/accept-invitation?invitationId=test"),
      "/accept-invitation?invitationId=test",
    );
    assert.equal(safeReturnTo(null), "/");
  });
  it("encodes invitation IDs without allowing additional query parameters", () => {
    assert.equal(
      invitationPath("id&next=//other.example"),
      "/accept-invitation?invitationId=id%26next%3D%2F%2Fother.example",
    );
    assert.equal(loginPath("test"), "/login?invitationId=test");
    assert.equal(loginPath(), "/login");
  });
});

describe("workspace identity", () => {
  it("only offers organisation management to owners and admins", () => {
    assert.equal(canManageOrganization("member"), false);
    assert.equal(canManageOrganization(undefined), false);
    assert.equal(canManageOrganization("owner"), true);
    assert.equal(canManageOrganization("member,admin"), true);
    assert.equal(canManageOrganization("superadmin"), false);
  });
  it("uses the signed-in user's initials", () => {
    assert.equal(initials("Jamie Davis"), "JD");
    assert.equal(initials("  Morgan  "), "M");
    assert.equal(initials(""), "U");
  });
});
