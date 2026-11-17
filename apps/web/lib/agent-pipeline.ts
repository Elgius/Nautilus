/** All browser durations use performance.now(), never the server's clock. */
export function startAgentTiming(roomId: string, runId: string) {
  const started = performance.now()
  let editorSaveMs = 0, observed = false
  const log = (stage: string) => {
    const elapsedMs = Math.round(performance.now() - started)
    console.info('[agent-pipeline]', JSON.stringify({ roomId, runId, stage, clientElapsedMs: elapsedMs, editorSaveMs }))
    return elapsedMs
  }
  log('browser.submit')
  return {
    editorSaved() { editorSaveMs = Math.round(performance.now() - started); log('browser.editor-saved') },
    firstOutput() {
      if (observed) return
      observed = true
      return { elapsedMs: log('browser.first-output'), editorSaveMs }
    },
  }
}
