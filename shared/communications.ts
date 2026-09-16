export const MARKETING_NOTICE_VERSION = "vanteloq-email-updates-v1";
export const MARKETING_PURPOSE = "Email me Vanteloq product news, practical business tips and occasional offers.";
export const MARKETING_WITHDRAWAL = "You can unsubscribe at any time in Settings or through a link in each marketing email. This choice does not affect your account or essential service messages.";
export type MarketingStatus = "not_chosen" | "subscribed" | "declined" | "unsubscribed" | "suppressed";
export type MarketingConfig = {
  available: boolean;
  noticeVersion: string;
  noticeHash: string | null;
  senderName: string;
  postalAddress: string | null;
  contactUrl: string;
  purpose: string;
  withdrawal: string;
};
export type MarketingPreference = {
  status: MarketingStatus;
  chosen: boolean;
  subscribed: boolean;
  revision: string | null;
  updatedAt: number | null;
  config: MarketingConfig;
};
