import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const inviteStatusEnum = pgEnum("invite_status", [
  "active",
  "used",
  "expired",
  "revoked",
]);

export const assetTypeEnum = pgEnum("asset_type", ["photo", "video", "sequence"]);

export const sequenceKindEnum = pgEnum("sequence_kind", [
  "hyperlapse",
  "panorama",
]);

export const chapterSourceEnum = pgEnum("chapter_source", ["auto", "manual"]);

export const flightGroupingMethodEnum = pgEnum("flight_grouping_method", [
  "auto",
  "manual",
]);

export const shareTypeEnum = pgEnum("share_type", ["public", "user"]);

export const shareTargetTypeEnum = pgEnum("share_target_type", [
  "asset",
  "flight",
  "album",
]);

export const albumMemberRoleEnum = pgEnum("album_member_role", [
  "editor",
  "viewer",
]);

export const telemetryParseStatusEnum = pgEnum("telemetry_parse_status", [
  "parsed",
  "unparsed",
  "failed",
]);

export const auditActionTypeEnum = pgEnum("audit_action_type", [
  "user.approve",
  "user.reject",
  "user.disable",
  "user.delete",
  "user.quota_change",
  "share.revoke",
  "invite.create",
  "invite.revoke",
  "integrity.run",
  "lut.create",
  "lut.delete",
]);

/** Which DJI log profile a .cube LUT is intended for. */
export const lutColorProfileEnum = pgEnum("lut_color_profile", [
  "d_log",
  "d_logm",
]);
