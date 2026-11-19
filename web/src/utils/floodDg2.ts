import type { FloodRoiResult, FloodRoiRun } from '../api/client.ts'

/** One controller per mounted panel. Invalidation fences every async continuation and timer. */
export function createFloodRunController(
  api: { start: (req: unknown, signal: AbortSignal) => Promise<FloodRoiRun>; status: (id: string, signal: AbortSignal) => Promise<FloodRoiRun>; results: (id: string, signal: AbortSignal) => Promise<FloodRoiResult>; preview: (id: string, name: string, signal: AbortSignal) => Promise<{blob: Blob; bounds: [number, number, number, number]}> },
  update: (value: {run?: FloodRoiRun; result?: FloodRoiResult; artifactName?: string; rasterUrl?: string; rasterBounds?: [number, number, number, number]; error?: string; roiKey: string} | null) => void,
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
  wait: (signal: AbortSignal) => Promise<void> = signal => new Promise(resolve => { const timer = setTimeout(resolve, 2000); signal.addEventListener('abort', () => {clearTimeout(timer); resolve()}, {once:true}) }),
) {
  let token=0, selection=0, abort: AbortController | null=null, objectUrl: string | null=null
  let committedPreview: { artifactName: string; rasterUrl: string; rasterBounds: [number, number, number, number] } | undefined
  function invalidate() {token++; selection++; abort?.abort(); abort=null; if(objectUrl) urls.revokeObjectURL(objectUrl); objectUrl=null; committedPreview=undefined; update(null)}
  async function start(req: unknown, roiKey: string) {
    invalidate(); const key=token; const controller=new AbortController(); abort=controller
    const current=()=>key===token && !controller.signal.aborted
    try {
      let run=await api.start(req,controller.signal)
      if(!current()) return
      update({run,roiKey})
      while(current() && !['succeeded','failed','timed_out'].includes(run.state)) {
        await wait(controller.signal)
        if(!current()) return
        run=await api.status(run.id,controller.signal)
        if(!current()) return
        update({run,roiKey})
      }
      if(!current() || run.state!=='succeeded') return
      const result=await api.results(run.id,controller.signal)
      if(!current()) return
      update({run,result,roiKey})
      return {run,result}
    } catch(e) {
      if(current()) update({roiKey,error:e instanceof Error ? e.message : 'Error de simulación'})
    }
  }
  async function select(run: FloodRoiRun, result: FloodRoiResult, name: string, roiKey: string) {
    if(!abort || abort.signal.aborted || !result.artifacts.some(a=>a.name===name)) return
    const key=token, choice=++selection, signal=abort.signal
    try {
      const image=await api.preview(run.id,name,signal)
      if(signal.aborted || token!==key || choice!==selection) return
      const url=urls.createObjectURL(image.blob)
      if(objectUrl) urls.revokeObjectURL(objectUrl)
      objectUrl=url
      committedPreview={artifactName:name,rasterUrl:url,rasterBounds:image.bounds}
      update({run,result,roiKey,...committedPreview})
    } catch(e) { if(token===key && choice===selection && !signal.aborted) update({run,result,roiKey,...committedPreview,error:e instanceof Error ? e.message : 'Error de preview'}) }
  }
  return {start,select,invalidate}
}
