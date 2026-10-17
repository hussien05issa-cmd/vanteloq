export const SETTINGS_SECTIONS = [
  { id: "profile", label: "My profile", keywords: "name personal preferences appearance dark light system theme" },
  { id: "account", label: "Account & login", keywords: "sign in sign out email password delete deletion remove account workspace" },
  { id: "security", label: "Security", keywords: "mfa authentication two factor sessions devices passkeys" },
  { id: "notifications", label: "Notifications", keywords: "alerts email marketing preferences" },
  { id: "organization", label: "Organization", keywords: "business company industry fiscal tax address" },
  { id: "branding", label: "Branding", keywords: "logo colour color identity" },
  { id: "navigation", label: "Sidebar & workspaces", keywords: "menu navigation hidden modules dashboard customize customise layout metrics kpi goals" },
  { id: "locations", label: "Locations", keywords: "stores branches address timezone" },
  { id: "integrations", label: "Integrations", keywords: "connections providers pos bank import" },
  { id: "privacy", label: "Data & privacy", keywords: "export retention consent ai data" },
  { id: "billing", label: "Billing & subscription", keywords: "cancel cancellation unsubscribe plan plans upgrade payment invoice stripe renewal trial bookloq" },
] as const;

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]["id"];

/** Billing links already sent to owners remain valid. Other sections have
 * explicit destinations so a location setup action cannot open My profile. */
export function settingsSectionFromHash(hash: string): SettingsSectionId | null {
  if (hash === "#billing") return "billing";
  if (!hash.startsWith("#settings/")) return null;
  const id = hash.slice("#settings/".length);
  return SETTINGS_SECTIONS.find(section => section.id === id)?.id ?? null;
}

export function settingsSectionHash(id: SettingsSectionId): string {
  return id === "billing" ? "#billing" : `#settings/${id}`;
}

export function filterSettingsSections(query: string) {
  const terms = query.trim().toLocaleLowerCase("en-CA").split(/\s+/u).filter(Boolean);
  return SETTINGS_SECTIONS.filter(section => {
    const searchable = `${section.label} ${section.keywords}`.toLocaleLowerCase("en-CA");
    return terms.every(term => searchable.includes(term));
  });
}
