/** Значение по умолчанию, если `LIBRETRANSLATE_URL` не задан (сервис поднимает compose.yml на порту LIBRETRANSLATE_PORT). */
export const LIBRETRANSLATE_DEFAULT_URL = "http://localhost:5000";

export const DETECT_ENDPOINT = "/detect";

/** Детект вызывается в середине потокового чтения книги, поэтому он не должен тянуть HTTP-запрос за собой. */
export const DETECT_TIMEOUT_MS = 5_000;

/** Ответы LibreTranslate с меньшей уверенностью считаем недостаточными для приёма книги. */
export const DETECT_MIN_CONFIDENCE = 0.5;
