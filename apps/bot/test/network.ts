import { setupNetwork } from "@msw/cloudflare";

// @discordjs/rest は module を読んだ時点の fetch を握るので、src を読む前（setupFiles の中）に差し替えて
// おく。spec はこの network に handler を足す。
export const network = setupNetwork();
