import { Package } from "../../shared/package"

export const DEFAULT_HEADERS = {
	"HTTP-Referer": "https://github.com/veniaminlunyov/bear-code",
	"X-Title": "BearCode",
	"User-Agent": `BearCode/${Package.version}`,
}
