import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  normalizeReviewCheckoutPath,
  normalizeReviewIgnoreRulePath,
  normalizeStoredReviewRelativePath,
} from "../reviewPathNormalization.ts";
import {
  ReviewIgnoreRuleRecord,
  ReviewIgnoreRuleRepository,
  type ReviewIgnoreRuleRepositoryShape,
} from "../Services/ReviewIgnoreRules.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeReviewIgnoreRuleRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRuleRow = SqlSchema.void({
    Request: ReviewIgnoreRuleRecord,
    execute: (rule) =>
      sql`
        INSERT INTO review_ignore_rules (
          checkout_path,
          rule_kind,
          normalized_path,
          match_path,
          created_at,
          updated_at
        )
        VALUES (
          ${rule.checkoutPath},
          ${rule.ruleKind},
          ${rule.normalizedPath},
          ${rule.matchPath},
          ${rule.createdAt},
          ${rule.updatedAt}
        )
        ON CONFLICT (checkout_path, rule_kind, normalized_path)
        DO UPDATE SET
          match_path = excluded.match_path,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `,
  });

  const listRuleRows = SqlSchema.findAll({
    Request: Schema.Struct({
      checkoutPath: Schema.String,
    }),
    Result: ReviewIgnoreRuleRecord,
    execute: ({ checkoutPath }) =>
      sql`
        SELECT
          checkout_path AS "checkoutPath",
          rule_kind AS "ruleKind",
          normalized_path AS "normalizedPath",
          match_path AS "matchPath",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM review_ignore_rules
        WHERE checkout_path = ${checkoutPath}
        ORDER BY normalized_path ASC, rule_kind ASC
      `,
  });

  const upsertNormalized: ReviewIgnoreRuleRepositoryShape["upsertNormalized"] = (input) =>
    Effect.try({
      try: () =>
        normalizeReviewIgnoreRulePath({
          checkoutPath: input.checkoutPath,
          rulePath: input.rulePath,
          ruleKind: input.ruleKind,
        }),
      catch: toPersistenceSqlError("ReviewIgnoreRuleRepository.upsertNormalized:normalize"),
    }).pipe(
      Effect.flatMap((normalized) =>
        upsertRuleRow({
          checkoutPath: normalized.normalizedCheckoutPath,
          ruleKind: input.ruleKind,
          normalizedPath: normalized.normalizedPath,
          matchPath: normalized.matchPath,
          createdAt: input.createdAt,
          updatedAt: input.updatedAt,
        }).pipe(
          Effect.as({
            checkoutPath: normalized.normalizedCheckoutPath,
            ruleKind: input.ruleKind,
            normalizedPath: normalized.normalizedPath,
            matchPath: normalized.matchPath,
            createdAt: input.createdAt,
            updatedAt: input.updatedAt,
          } satisfies ReviewIgnoreRuleRecord),
          Effect.mapError(
            toPersistenceSqlOrDecodeError(
              "ReviewIgnoreRuleRepository.upsertNormalized:query",
              "ReviewIgnoreRuleRepository.upsertNormalized:encodeRequest",
            ),
          ),
        ),
      ),
    );

  const listByCheckoutPath: ReviewIgnoreRuleRepositoryShape["listByCheckoutPath"] = (input) =>
    listRuleRows({
      checkoutPath: normalizeReviewCheckoutPath(input.checkoutPath),
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ReviewIgnoreRuleRepository.listByCheckoutPath:query",
          "ReviewIgnoreRuleRepository.listByCheckoutPath:decodeRows",
        ),
      ),
    );

  const deleteRule: ReviewIgnoreRuleRepositoryShape["delete"] = (input) =>
    sql`
      DELETE FROM review_ignore_rules
      WHERE checkout_path = ${normalizeReviewCheckoutPath(input.checkoutPath)}
        AND rule_kind = ${input.ruleKind}
        AND normalized_path = ${normalizeStoredReviewRelativePath(input.normalizedPath)}
    `.pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ReviewIgnoreRuleRepository.delete:query")),
    );

  return {
    upsertNormalized,
    listByCheckoutPath,
    delete: deleteRule,
  } satisfies ReviewIgnoreRuleRepositoryShape;
});

export const ReviewIgnoreRuleRepositoryLive = Layer.effect(
  ReviewIgnoreRuleRepository,
  makeReviewIgnoreRuleRepository,
);
