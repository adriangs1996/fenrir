import { Effect, Layer } from "effect";

import { ReviewAnnotationRepository } from "../../persistence/Services/ReviewAnnotations.ts";
import { ReviewAnalysisRepository } from "../../persistence/Services/ReviewAnalysis.ts";
import { ReviewProgressRepository } from "../../persistence/Services/ReviewProgress.ts";
import { ReviewSessionRepository } from "../../persistence/Services/ReviewSessions.ts";
import { SourceControlStatus } from "../../sourceControl/Services/SourceControlStatus.ts";
import { SessionCredentialService } from "../../auth/Services/SessionCredentialService.ts";
import { ReviewAnalysisService } from "../Services/ReviewAnalysisService.ts";
import { ReviewDiffService } from "../Services/ReviewDiffService.ts";
import { ReviewRpcService, makeReviewRpcService } from "../Services/ReviewRpcService.ts";
import { ReviewSessionService } from "../Services/ReviewSessionService.ts";
import { ReviewWriteService } from "../Services/ReviewWriteService.ts";

const makeLayer = Effect.gen(function* () {
  const sessions = yield* ReviewSessionRepository;
  const annotations = yield* ReviewAnnotationRepository;
  const progress = yield* ReviewProgressRepository;
  const analysis = yield* ReviewAnalysisRepository;
  const analysisService = yield* ReviewAnalysisService;
  const diff = yield* ReviewDiffService;
  const sessionService = yield* ReviewSessionService;
  const write = yield* ReviewWriteService;
  const sourceControlStatus = yield* SourceControlStatus;
  const authSessions = yield* SessionCredentialService;

  return yield* makeReviewRpcService({
    sessions,
    annotations,
    progress,
    analysis,
    analysisService,
    diff,
    sessionService,
    write,
    sourceControlStatus,
    authSessions,
  });
});

export const ReviewRpcServiceLive = Layer.effect(ReviewRpcService, makeLayer);
