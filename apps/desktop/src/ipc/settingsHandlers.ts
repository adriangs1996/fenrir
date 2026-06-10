import type {
  ClientSettings,
  DesktopEnvironmentBootstrap,
  DesktopServerExposureMode,
  DesktopServerExposureState,
  PersistedSavedEnvironmentRecord,
} from "@fenrir/contracts";
import {
  GET_CLIENT_SETTINGS_CHANNEL,
  GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL,
  GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL,
  GET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  GET_SERVER_EXPOSURE_STATE_CHANNEL,
  REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  SET_CLIENT_SETTINGS_CHANNEL,
  SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL,
  SET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
  SET_SERVER_EXPOSURE_MODE_CHANNEL,
} from "@fenrir/contracts";

import {
  readClientSettings,
  readSavedEnvironmentRegistry,
  readSavedEnvironmentSecret,
  removeSavedEnvironmentSecret,
  writeClientSettings,
  writeSavedEnvironmentRegistry,
  writeSavedEnvironmentSecret,
} from "../settings/DesktopClientSettings";
import { registerHandler, registerListener } from "./registerHandler";
import { requireArray, requireNonBlankString, requireObject, ValidationError } from "./validators";

export interface DesktopSecretStorage {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (value: string) => Buffer;
  readonly decryptString: (value: Buffer) => string;
}

export interface SettingsHandlersDeps {
  readonly clientSettingsPath: string;
  readonly savedEnvironmentRegistryPath: string;
  readonly getLocalEnvironmentBootstrap: () => DesktopEnvironmentBootstrap;
  readonly getSecretStorage: () => DesktopSecretStorage;
  readonly getServerExposureState: () => DesktopServerExposureState;
  readonly getServerExposureMode: () => DesktopServerExposureMode;
  readonly applyServerExposureMode: (
    mode: DesktopServerExposureMode,
    options: { readonly persist: boolean; readonly rejectIfUnavailable: boolean },
  ) => Promise<DesktopServerExposureState>;
  readonly relaunch: (reason: string) => void;
}

export function registerSettingsHandlers(deps: SettingsHandlersDeps): void {
  registerListener(GET_LOCAL_ENVIRONMENT_BOOTSTRAP_CHANNEL, (event) => {
    event.returnValue = deps.getLocalEnvironmentBootstrap();
  });

  registerHandler(GET_CLIENT_SETTINGS_CHANNEL, async () =>
    readClientSettings(deps.clientSettingsPath),
  );

  registerHandler(SET_CLIENT_SETTINGS_CHANNEL, async (_event, rawSettings: unknown) => {
    const settings = requireObject("client settings payload", rawSettings);
    writeClientSettings(deps.clientSettingsPath, settings as ClientSettings);
  });

  registerHandler(GET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, async () =>
    readSavedEnvironmentRegistry(deps.savedEnvironmentRegistryPath),
  );

  registerHandler(SET_SAVED_ENVIRONMENT_REGISTRY_CHANNEL, async (_event, rawRecords: unknown) => {
    const records = requireArray("saved environment registry payload", rawRecords);
    writeSavedEnvironmentRegistry(
      deps.savedEnvironmentRegistryPath,
      records as readonly PersistedSavedEnvironmentRecord[],
    );
  });

  registerHandler(GET_SAVED_ENVIRONMENT_SECRET_CHANNEL, async (_event, rawEnvironmentId) => {
    // Silent semantics: invalid ids resolve to `null` instead of throwing.
    if (typeof rawEnvironmentId !== "string" || rawEnvironmentId.trim().length === 0) {
      return null;
    }

    return readSavedEnvironmentSecret({
      registryPath: deps.savedEnvironmentRegistryPath,
      environmentId: rawEnvironmentId,
      secretStorage: deps.getSecretStorage(),
    });
  });

  registerHandler(
    SET_SAVED_ENVIRONMENT_SECRET_CHANNEL,
    async (_event, rawEnvironmentId: unknown, rawSecret: unknown) => {
      const environmentId = requireNonBlankString("saved environment id", rawEnvironmentId);
      const secret = requireNonBlankString("saved environment secret", rawSecret);

      return writeSavedEnvironmentSecret({
        registryPath: deps.savedEnvironmentRegistryPath,
        environmentId,
        secret,
        secretStorage: deps.getSecretStorage(),
      });
    },
  );

  registerHandler(REMOVE_SAVED_ENVIRONMENT_SECRET_CHANNEL, async (_event, rawEnvironmentId) => {
    // Silent semantics: invalid ids are ignored instead of throwing.
    if (typeof rawEnvironmentId !== "string" || rawEnvironmentId.trim().length === 0) {
      return;
    }

    removeSavedEnvironmentSecret({
      registryPath: deps.savedEnvironmentRegistryPath,
      environmentId: rawEnvironmentId,
    });
  });

  registerHandler(GET_SERVER_EXPOSURE_STATE_CHANNEL, async () => deps.getServerExposureState());

  registerHandler(SET_SERVER_EXPOSURE_MODE_CHANNEL, async (_event, rawMode: unknown) => {
    if (rawMode !== "local-only" && rawMode !== "network-accessible") {
      throw new ValidationError("desktop server exposure input");
    }

    const nextMode: DesktopServerExposureMode = rawMode;
    if (nextMode === deps.getServerExposureMode()) {
      return deps.getServerExposureState();
    }

    const nextState = await deps.applyServerExposureMode(nextMode, {
      persist: true,
      rejectIfUnavailable: true,
    });
    deps.relaunch(`serverExposureMode=${nextMode}`);
    return nextState;
  });
}
