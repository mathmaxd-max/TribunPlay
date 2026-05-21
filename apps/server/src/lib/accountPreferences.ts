export type PreferredSeatColor = "black" | "white" | "none";

export type BoardSfxPreferences = {
	muted: boolean;
	volume: number;
};

export type AccountPreferences = {
	singleClickCancelReselect: boolean;
	preferredSeatColor: PreferredSeatColor;
	streamerMode: boolean;
	boardSfx: BoardSfxPreferences;
};

export type AccountPreferencesPatch = Partial<{
	singleClickCancelReselect: boolean;
	preferredSeatColor: PreferredSeatColor;
	streamerMode: boolean;
	boardSfx: Partial<BoardSfxPreferences>;
}>;

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
	singleClickCancelReselect: false,
	preferredSeatColor: "none",
	streamerMode: false,
	boardSfx: {
		muted: false,
		volume: 1,
	},
};

const clampVolume = (value: unknown): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_ACCOUNT_PREFERENCES.boardSfx.volume;
	}
	return Math.max(0, Math.min(2, value));
};

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const normalizeBoardSfx = (raw: unknown): BoardSfxPreferences => {
	if (!isObject(raw)) return { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx };
	return {
		muted: typeof raw.muted === "boolean" ? raw.muted : DEFAULT_ACCOUNT_PREFERENCES.boardSfx.muted,
		volume: clampVolume(raw.volume),
	};
};

export const normalizeAccountPreferences = (raw: unknown | null): AccountPreferences => {
	if (raw === null || raw === undefined) {
		return { ...DEFAULT_ACCOUNT_PREFERENCES, boardSfx: { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx } };
	}

	let parsed: unknown = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return { ...DEFAULT_ACCOUNT_PREFERENCES, boardSfx: { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx } };
		}
	}

	if (!isObject(parsed)) {
		return { ...DEFAULT_ACCOUNT_PREFERENCES, boardSfx: { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx } };
	}

	const preferredSeatColor =
		parsed.preferredSeatColor === "black" ||
		parsed.preferredSeatColor === "white" ||
		parsed.preferredSeatColor === "none"
			? parsed.preferredSeatColor
			: DEFAULT_ACCOUNT_PREFERENCES.preferredSeatColor;

	return {
		singleClickCancelReselect:
			typeof parsed.singleClickCancelReselect === "boolean"
				? parsed.singleClickCancelReselect
				: DEFAULT_ACCOUNT_PREFERENCES.singleClickCancelReselect,
		preferredSeatColor,
		streamerMode:
			typeof parsed.streamerMode === "boolean" ? parsed.streamerMode : DEFAULT_ACCOUNT_PREFERENCES.streamerMode,
		boardSfx: normalizeBoardSfx(parsed.boardSfx),
	};
};

export const mergePreferencesPatch = (
	current: AccountPreferences,
	patch: AccountPreferencesPatch,
): AccountPreferences => {
	const nextBoardSfx = patch.boardSfx
		? {
				muted:
					typeof patch.boardSfx.muted === "boolean" ? patch.boardSfx.muted : current.boardSfx.muted,
				volume: patch.boardSfx.volume !== undefined ? clampVolume(patch.boardSfx.volume) : current.boardSfx.volume,
			}
		: current.boardSfx;

	return normalizeAccountPreferences({
		singleClickCancelReselect:
			patch.singleClickCancelReselect !== undefined
				? patch.singleClickCancelReselect
				: current.singleClickCancelReselect,
		preferredSeatColor:
			patch.preferredSeatColor !== undefined ? patch.preferredSeatColor : current.preferredSeatColor,
		streamerMode: patch.streamerMode !== undefined ? patch.streamerMode : current.streamerMode,
		boardSfx: nextBoardSfx,
	});
};

export const serializeAccountPreferences = (preferences: AccountPreferences): string =>
	JSON.stringify(preferences);
