// ABOUTME: Closed persona enumeration + the registry interface the spawn-broker uses to build full container specs
// ABOUTME: The broker — not the caller — owns spec assembly; this is the contract for that assembly

import type { ContainerConfig } from './types';

// The closed set of container personas the broker can spawn. Confirmed against
// the live sen-core persona files in agent-runtime/user/agent-personas/
// (browser-driver.md, persistent-box.md, ephemeral-shell.md — each with
// `runtime.type: container`) and the persona image build keys in
// sen-core src/cli/images.ts (sen-browser / sen-persistent-box /
// sen-ephemeral-shell). `as const` keeps the tuple literal so it can seed a
// zod enum and the PersonaName union without drift.
export const PERSONA_NAMES = ['browser-driver', 'persistent-box', 'ephemeral-shell'] as const;

export type PersonaName = (typeof PERSONA_NAMES)[number];

export function isPersonaName(value: unknown): value is PersonaName {
  return typeof value === 'string' && (PERSONA_NAMES as readonly string[]).includes(value);
}

/**
 * Per-spawn parameterization. Carries ONLY the values the broker stamps into an
 * otherwise registry-defined spec: the broker-generated container name, the
 * session/job ids used for container labels and bookkeeping, and the
 * broker-minted agent token injected as an env var. It carries NO spec fields
 * (no image/mounts/network/etc.) — those come entirely from the registry.
 */
export interface PersonaSpawnContext {
  sessionId: string;
  jobId: string;
  containerName: string;
  agentToken: string;
}

/**
 * Builds the FULL ContainerConfig for a persona, entirely registry-side. The
 * caller never supplies any part of the returned spec; this is the load-bearing
 * security boundary of the spawn broker.
 */
export interface PersonaRegistry {
  buildContainerConfig(persona: PersonaName, ctx: PersonaSpawnContext): ContainerConfig;
}

/**
 * Placeholder registry. Throws until the per-persona specs are enumerated from
 * the live persona files. The enumeration is intentionally NOT inlined here —
 * inventing the values would risk drift from the real persona definitions.
 *
 * TODO(PRI-2012): populate from the persona-file enumeration. Each persona's
 * ContainerConfig must be assembled from its sen-core persona file
 * (agent-runtime/user/agent-personas/<persona>.md, `runtime:` block). The fields
 * to fill, per persona:
 *
 *   browser-driver  (sen-browser:dev, per_invocation):
 *     image:        sen-browser:dev
 *     workingDirectory: /work
 *     mounts:       knowledge→/knowledge, identity→/sen/identity, sen-cred→/run,
 *                   sen-ca→/etc/sen-credential-proxy-ca,
 *                   sen-browser-cdp→/sen-browser-cdp, plus lace-injected
 *                   per_invocation scratch at /work
 *     environment:  DISPLAY=":1", NODE_EXTRA_CA_CERTS + SSL_CERT_FILE = the
 *                   broker CA pem, plus the injected agent token / CDP socket
 *     ports:        host 6080 → container 6080  (NOTE: not in the 2.1 field list — see report)
 *     sysctls:      net.ipv6.conf.lo.disable_ipv6=0, net.ipv6.conf.all.disable_ipv6=1
 *     network:      quarantine
 *     gatewayRoute: 172.31.250.2
 *     capAdd:       (none today — netns-init sidecar holds NET_ADMIN, not the persona)
 *     command:      persona-predefined (no caller command)
 *     (also: browserCdpSocket=true wiring — CDP socket dir + SEN_BROWSER_CDP_SOCKET env)
 *
 *   persistent-box  (sen-persistent-box:dev, persistent):
 *     image:        sen-persistent-box:dev
 *     workingDirectory: /home/sen
 *     mounts:       home→/home/sen, scratch→/work, knowledge→/knowledge,
 *                   identity→/sen/identity, sen-cred→/run,
 *                   sen-ca→/etc/sen-credential-proxy-ca
 *     environment:  HOME=/home/sen, NODE_EXTRA_CA_CERTS + SSL_CERT_FILE = broker CA pem
 *     sysctls:      net.ipv6.conf.all.disable_ipv6=1
 *     network:      quarantine
 *     gatewayRoute: 172.31.250.2
 *     restartPolicy: unless-stopped  (persistent box survives host reboot)
 *     command:      persona-predefined
 *
 *   ephemeral-shell (sen-ephemeral-shell:dev, per_invocation):
 *     image:        sen-ephemeral-shell:dev
 *     workingDirectory: /work
 *     mounts:       knowledge→/knowledge, identity→/sen/identity, sen-cred→/run,
 *                   sen-ca→/etc/sen-credential-proxy-ca, plus lace-injected
 *                   per_invocation scratch at /work
 *     environment:  NODE_EXTRA_CA_CERTS + SSL_CERT_FILE = broker CA pem
 *     sysctls:      net.ipv6.conf.all.disable_ipv6=1
 *     network:      quarantine
 *     gatewayRoute: 172.31.250.2
 *     command:      persona-predefined
 *
 * The named mounts (knowledge/identity/sen-cred/sen-ca/sen-browser-cdp/home/
 * scratch) resolve to host paths from the embedder-supplied named-mount registry
 * at materialization time — that resolution must move broker-side too.
 */
export class StubPersonaRegistry implements PersonaRegistry {
  buildContainerConfig(_persona: PersonaName, _ctx: PersonaSpawnContext): ContainerConfig {
    throw new Error('persona registry not yet populated — pending PRI-2012 persona enumeration');
  }
}
