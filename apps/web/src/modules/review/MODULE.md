# review

## Public Surface

- `ReviewTabShell`
- `parseReviewRouteSearch()`
- `resolveReviewRouteState()`
- `buildReviewRouteSearch()`
- `stripReviewSearchParams()`

## Responsibilities

- Own the first-class `Review` chat tab shell.
- Own route-backed review selection state that can be shared in thread URLs.
- Keep ephemeral review UI concerns out of route state.

## Route State

- `tab=review`
- `reviewMode=raw|review`
- `reviewScope=uncommitted|branch|combined`
- `reviewGroupId`
- `reviewFileId`
- `reviewChunkId`
- `reviewCommentId`

## Notes

- This module currently provides the tab shell and canonical route-state helpers.
- Data loading and actionable review workflows land in later plans on top of this surface.
