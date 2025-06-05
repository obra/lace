// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../../resource.mjs";
import * as MessagesAPI from "./messages.mjs";
import { Messages, } from "./messages.mjs";
export class PromptCaching extends APIResource {
    constructor() {
        super(...arguments);
        this.messages = new MessagesAPI.Messages(this._client);
    }
}
PromptCaching.Messages = Messages;
//# sourceMappingURL=prompt-caching.mjs.map