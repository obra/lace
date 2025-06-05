// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.
import { APIResource } from "../../resource.mjs";
import * as MessagesAPI from "./messages/messages.mjs";
import { Messages, } from "./messages/messages.mjs";
import * as PromptCachingAPI from "./prompt-caching/prompt-caching.mjs";
import { PromptCaching } from "./prompt-caching/prompt-caching.mjs";
export class Beta extends APIResource {
    constructor() {
        super(...arguments);
        this.messages = new MessagesAPI.Messages(this._client);
        this.promptCaching = new PromptCachingAPI.PromptCaching(this._client);
    }
}
Beta.Messages = Messages;
Beta.PromptCaching = PromptCaching;
//# sourceMappingURL=beta.mjs.map