/** Explicit subject-bound preview grants for disposable integration fixtures only. */
export async function grantIntegrationPreview(database, environment, organizationId, email) {
  environment.VANTELOQ_INTERNAL_ACCESS_ENABLED = "true";
  const user = await database.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (!user) throw Error("Preview fixture requires an existing user");
  const now = Math.floor(Date.now() / 1000);
  await database.prepare("INSERT INTO internal_access (id,user_id,organization_id,access_level,reason,active,mfa_required,created_by_user_id,created_at,updated_at) VALUES (?,?,?,'founder','Isolated provider callback fixture',1,1,?,?,?)")
    .bind(crypto.randomUUID(), user.id, organizationId, user.id, now, now).run();
}
