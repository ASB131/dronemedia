const RETURN_PATH_KEY = "dm-media-return-path";

type TimelineScrollState = {
  scrollTop: number;
  focusAssetId: string;
  favoritesOnly: boolean;
};

function scrollKey(favoritesOnly: boolean) {
  return favoritesOnly
    ? "dm-timeline-scroll:favorites"
    : "dm-timeline-scroll:home";
}

export function setMediaReturnPath(path: string) {
  try {
    sessionStorage.setItem(RETURN_PATH_KEY, path);
  } catch {
    // ignore quota / private mode
  }
}

export function getMediaReturnPath(): string | null {
  try {
    return sessionStorage.getItem(RETURN_PATH_KEY);
  } catch {
    return null;
  }
}

export function saveTimelineScrollPosition(params: {
  scrollTop: number;
  focusAssetId: string;
  favoritesOnly: boolean;
}) {
  try {
    const payload: TimelineScrollState = {
      scrollTop: params.scrollTop,
      focusAssetId: params.focusAssetId,
      favoritesOnly: params.favoritesOnly,
    };
    sessionStorage.setItem(
      scrollKey(params.favoritesOnly),
      JSON.stringify(payload),
    );
    setMediaReturnPath(params.favoritesOnly ? "/favorites" : "/");
  } catch {
    // ignore
  }
}

export function peekTimelineScrollPosition(
  favoritesOnly: boolean,
): TimelineScrollState | null {
  try {
    const raw = sessionStorage.getItem(scrollKey(favoritesOnly));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimelineScrollState;
    if (
      typeof parsed.scrollTop !== "number" ||
      typeof parsed.focusAssetId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearTimelineScrollPosition(favoritesOnly: boolean) {
  try {
    sessionStorage.removeItem(scrollKey(favoritesOnly));
  } catch {
    // ignore
  }
}
