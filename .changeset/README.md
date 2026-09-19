# Changesets

Add a changeset for every user-visible package change:

```bash
npm run changeset
```

Choose the semantic version bump and describe the released behavior. Documentation, tests, and release-infrastructure-only changes may use an empty changeset when required by CI.

The release workflow maintains the version pull request. Do not run `npm run version-packages` on a feature branch.
