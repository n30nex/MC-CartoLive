# MC-CartoLive 3.2.0 Errata

This note corrects the original 3.2.0 release record without rewriting its
attached immutable assets.

- The hosted Canada 3.2.0 cutover created a fresh schema-32000 database. The
  attached release manifest and tagged documentation incorrectly described the
  hosted cutover as preserved. Later 3.2.0 candidate deployments preserved that
  new database.
- The generic 3.2.0 GHCR tags were promoted from a Canada-asset build even
  though the README defined the generic image as world. 3.2.1 restores separate
  world and Canada digests/tags.
- Desktop browser smoke was not a required branch check and was failing when
  several 3.2.0 release PRs merged. The initial validation checklist therefore
  remains unchecked. 3.2.1 makes browser smoke a protected-main candidate gate
  and requires fresh evidence.
- Production later ran unreleased 3.2.0 candidate commits ahead of the published
  3.2.0 tag while retaining the same version label. 3.2.1 publishes and deploys
  one explicit source identity with separate world/Canada image identities.

Use the 3.2.1 release manifest and validation record for current deployment
decisions.
