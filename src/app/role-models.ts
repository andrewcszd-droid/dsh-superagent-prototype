/** Resolves and seeds per-role default models on newly created sessions without mutating the global DSH default. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SKILL_PREFIX } from './prompts.ts'
import type { RoleModel } from '../policy.ts'

/** Resolve a configured route through the live provider; catalog membership is not a restriction. */
export async function resolveRoleModel(ctx: Context, model: RoleModel): Promise<ModelSelection> {
  const value = await ctx.llm.resolveCallConfig({ provider: model.provider, model: model.model,
    ...(model.reasoningEffort ? { reasoningEffort: ReasoningEffortId(model.reasoningEffort) } : {}) })
  return { provider: value.provider, model: value.model, ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) }
}

/** The mounted team-skill key a skill-tool call loads (`dsh-superagent-<key>`), or `undefined` for anything else. */
export function teamSkillKey(arguments_: unknown): string | undefined {
  const name = typeof arguments_ === 'object' && arguments_ !== null && Object.hasOwn(arguments_, 'name')
    ? (arguments_ as { name: unknown }).name : undefined
  return typeof name === 'string' && name.startsWith(SKILL_PREFIX) ? name.slice(SKILL_PREFIX.length) : undefined
}

/** One Executor Session's armed expert tier: the selection its following requests and prompt variables run. */
export interface ExpertTier {
  /** Resolve `model` through the live provider and run it from the next request on, recorded durably; a failed resolve keeps the current tier. */
  apply(model: RoleModel): Promise<ModelSelection>
  /** The selection applied so far, if any. */
  current(): ModelSelection | undefined
  /** Stop applying, leaving the Session's durable selection in DSH's hands. */
  dispose(): void
}

/** Arm one Executor Session's expert-tier application: what `apply` sets last wins, until `dispose`. */
export function installExpertTier(ctx: Context, agent: Agent): ExpertTier {
  let current: ModelSelection | undefined
  const same = (a: { provider: string; model: string; reasoningEffort?: string }, b: ModelSelection): boolean =>
    a.provider === b.provider && a.model === b.model && (a.reasoningEffort ?? undefined) === (b.reasoningEffort === undefined ? undefined : String(b.reasoningEffort))
  const disposers = [
    agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const result = await next()
      return current ? { ...result, variables: { ...result.variables, provider: current.provider, model: current.model } } : result
    }, { prepend: true }),
    agent.ctx.on('agent/request', async (_payload, next) => {
      const result = await next()
      if (!current) return result
      const { reasoningEffort: _inherited, ...rest } = result
      return { ...rest, ...current }
    }, { prepend: true }),
  ]
  return {
    async apply(model) {
      const selected = await resolveRoleModel(ctx, model)
      current = selected
      const last = [...agent.session.snapshotEvents()].reverse().find(event => event.type === 'model/selection')?.data as
        { provider: string; model: string; reasoningEffort?: string } | undefined
      if (!last || !same(last, selected)) agent.session.append('model/selection', selected)
      return selected
    },
    current: () => current,
    dispose: () => { current = undefined; disposers.forEach(dispose => dispose()) },
  }
}

/** Seed a role's configured model onto a brand-new session before its first request, leaving later manual or durable selections intact. */
export async function initializeRoleModel(ctx: Context, agent: Agent, model: RoleModel | null): Promise<void> {
  if (!model) return
  if (agent.session.requestHeader() || agent.session.snapshotEvents().some(event => event.type === 'model/selection')) return
  const selected = await resolveRoleModel(ctx, model)
  // Avoid selectModel because it mutates the global DSH default; inject the selection for the initial request only.
  agent.session.append('model/selection', selected)
  let initial = true
  let assembled: ModelSelection | undefined
  agent.ctx.effect(() => {
    const disposers = [
      agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
        const selection = initial ? selected : undefined
        const result = await next()
        assembled = selection
        return selection ? { ...result, variables: { ...result.variables, provider: selection.provider, model: selection.model } } : result
      }, { prepend: true }),
      agent.ctx.on('agent/request', async (_payload, next) => {
        const result = await next()
        if (!assembled) return result
        const { reasoningEffort: _inherited, ...rest } = result
        return { ...rest, ...assembled }
      }, { prepend: true }),
      ctx.on('session/event', (session, event) => {
        if (session === agent.session && (event.type === 'request/header' || event.type === 'model/selection')) initial = false
      }),
    ]
    return () => disposers.forEach(dispose => dispose())
  })
  await ctx.sessionPersistence.flush()
}
