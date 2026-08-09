UPDATE `internal_access`
SET `mfa_required` = 0
WHERE `access_level` = 'founder';
