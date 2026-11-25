import os,json,re,asyncio
import aiohttp
from datetime import date
from pipecat.frames.frames import AudioRawFrame, InputAudioRawFrame, OutputAudioRawFrame, TranscriptionFrame, TextFrame, LLMTextFrame, LLMContextFrame, LLMFullResponseStartFrame, LLMFullResponseEndFrame, FunctionCallsStartedFrame, LLMRunFrame, InterruptionFrame
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.transports.websocket.server import WebsocketServerTransport, WebsocketServerParams
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner
from pipecat.services.elevenlabs.stt import ElevenLabsSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.turns.user_turn_strategies import UserTurnStrategies
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.processors.frame_processor import FrameProcessor
import store
class PCMSerializer(FrameSerializer):
    async def serialize(self, frame):
        if isinstance(frame,OutputAudioRawFrame): return frame.audio
        if isinstance(frame,InterruptionFrame): return json.dumps({'type':'interrupt'})
        return None
    async def deserialize(self,data):
        if isinstance(data,bytes): return InputAudioRawFrame(audio=data,sample_rate=16000,num_channels=1)
        return None
    async def setup(self,frame): pass
    @property
    def type(self): return FrameSerializer.FrameSerializerType.BINARY if hasattr(FrameSerializer,'FrameSerializerType') else 'binary'
class Transcript(FrameProcessor):
    def __init__(self,ws,role,state=None): super().__init__(); self.ws=ws; self.role=role; self.state=state; self.tool_call=False
    async def _set_thinking(self,active):
        if self.state is not None and self.state.get('thinking')!=active:
            self.state['thinking']=active
            await self.ws.send_json({'type':'thinking','active':active})
    async def process_frame(self,frame,direction):
        await super().process_frame(frame,direction)
        if self.role=='caller' and isinstance(frame,TranscriptionFrame):
            cleaned=re.sub(r'\[[^\]]*\]|\([^)]*\)','',frame.text).strip()
            if not cleaned:
                return
            frame.text=cleaned
            await self.ws.send_json({'type':'transcript','role':self.role,'text':cleaned})
        elif self.role=='thinking' and isinstance(frame,LLMContextFrame):
            await self._set_thinking(True)
        elif self.role=='assistant':
            if isinstance(frame,LLMFullResponseStartFrame):
                self.tool_call=False
            elif isinstance(frame,FunctionCallsStartedFrame):
                self.tool_call=True
            elif isinstance(frame,LLMTextFrame):
                if frame.text:
                    await self._set_thinking(False)
                await self.ws.send_json({'type':'transcript','role':self.role,'text':frame.text})
            elif isinstance(frame,InterruptionFrame) or (isinstance(frame,LLMFullResponseEndFrame) and not self.tool_call):
                await self._set_thinking(False)
        await self.push_frame(frame,direction)
class ResilientGoogleLLMService(GoogleLLMService):
    async def _process_context(self, context):
        primary=self._model_name
        fallbacks=[m for m in (primary,'gemini-flash-lite-latest','gemini-3-flash-preview','gemini-3.6-flash') if m]
        tried=[]
        for model in fallbacks:
            if model in tried: continue
            tried.append(model)
            self._model_name=model
            last_err=None
            async def _capture_error(error_msg,exception=None,fatal=False):
                nonlocal last_err
                last_err=(error_msg,exception,fatal)
            orig_push_error=self.push_error
            self.push_error=_capture_error
            try:
                await super()._process_context(context)
            finally:
                self.push_error=orig_push_error
            if last_err is None:
                self._model_name=primary
                return
            msg,exc,fatal=last_err
            if any(k in msg for k in ('503','429','UNAVAILABLE','RESOURCE_EXHAUSTED')) and len(tried)<len(fallbacks):
                await asyncio.sleep(0.3)
                continue
            self._model_name=primary
            await orig_push_error(error_msg=msg,exception=exc,fatal=fatal)
            return
        self._model_name=primary
async def run_voice(ws):
    async with aiohttp.ClientSession() as session:
        await run_voice_pipeline(ws, session)

async def run_voice_pipeline(ws, session):
    vad=SileroVADAnalyzer(params=VADParams(confidence=0.68,start_secs=0.2,stop_secs=1.0,min_volume=0.4))
    transport=WebsocketServerTransport(host="127.0.0.1",port=8765,params=WebsocketServerParams(audio_in_enabled=True,audio_out_enabled=True,add_wav_header=False,serializer=PCMSerializer(),vad_analyzer=vad))
    stt = ElevenLabsSTTService(
        api_key=os.environ['ELEVENLABS_API_KEY'],
        aiohttp_session=session
    )
    tts=ElevenLabsTTSService(api_key=os.environ['ELEVENLABS_API_KEY'],voice_id=os.getenv('ELEVENLABS_VOICE_ID','EXAVITQu4vr4xnSDxMaL'))
    llm=ResilientGoogleLLMService(
        api_key=os.environ['GOOGLE_API_KEY'],
        model=os.getenv('GEMINI_MODEL','gemini-3.5-flash-lite'),
        params=GoogleLLMService.InputParams(thinking=GoogleLLMService.ThinkingConfig(thinking_level='minimal')),
    )
    def schema(name,description,props,required): return FunctionSchema(name=name,description=description,properties=props,required=required)
    string={'type':'string'}; integer={'type':'integer'}; boolean={'type':'boolean'}
    tools=ToolsSchema(standard_tools=[schema('check_doctor_availability','Find open slots by doctor or specialty and optional ISO date',{'doctor':string,'day':string},[]),schema('book_appointment','Book only after reading phone back and receiving explicit confirmation',{'slot_id':integer,'phone':string,'confirmed':boolean},['slot_id','phone','confirmed']),schema('cancel_appointment','Cancel only after confirming spoken phone and intended cancellation; appointment_id optional',{'phone':string,'confirmed':boolean,'appointment_id':integer},['phone','confirmed'])])
    async def check(p):
        args=dict(p.arguments or {})
        await p.result_callback({'slots':store.availability(doctor=args.get('doctor',''),day=args.get('day',''))[:15]})
    async def mutate(p,fn):
        args=dict(p.arguments or {})
        if not args.pop('confirmed',False): await p.result_callback({'error':'Confirm spoken phone first'}); return
        try: result=fn(**args)
        except (ValueError,TypeError) as e: result={'error':str(e)}
        snap=store.dashboard()
        await ws.send_json(snap)
        if fn is store.book and isinstance(result,dict) and 'error' not in result:
            appt=next((a for a in snap['appointments'] if a['id']==result['appointment_id']),None)
            if appt:
                await ws.send_json({'type':'booked','appointment':appt})
        await p.result_callback(result)
    async def book(p): await mutate(p,store.book)
    async def cancel(p): await mutate(p,store.cancel)
    for name,fn in [('check_doctor_availability',check),('book_appointment',book),('cancel_appointment',cancel)]: llm.register_function(name,fn)
    context=LLMContext([{'role':'system','content':f'You are Careline, a friendly appointment receptionist. Today is {date.today()} in India. Greet briefly once at the start of the call. Only schedule appointments; no medical advice. You can book or cancel multiple appointments in one call. Ask the caller to speak their 10 digit phone number, convert spoken digits into 10 digits, read each digit back, and wait for explicit confirmation before booking or cancelling. Never guess phone numbers, dates or slot IDs. Use tools for every availability check and mutation. Ask which appointment if multiple. Never claim success unless tool succeeded. Offer a few slots, speak concise natural English. Confirm selected slot before booking and intended cancellation before cancelling.'}],tools=tools)
    agg=LLMContextAggregatorPair(context,user_params=LLMUserAggregatorParams(user_turn_strategies=UserTurnStrategies(),user_turn_stop_timeout=2.5))
    ui_state={'thinking':False}
    task=PipelineTask(Pipeline([transport.input(),stt,Transcript(ws,'caller'),agg.user(),Transcript(ws,'thinking',ui_state),llm,Transcript(ws,'assistant',ui_state),tts,transport.output(),agg.assistant()]),params=PipelineParams(audio_in_sample_rate=16000,audio_out_sample_rate=24000,allow_interruptions=True))
    @task.event_handler('on_pipeline_error')
    async def on_error(task, error):
        await ws.send_json({'type':'error','text':getattr(error,'error',str(error))})
    @transport.event_handler('on_client_connected')
    async def connected(transport, client):
        ws.client=client
        await ws.send_json({'type':'ready'})
        await ws.send_json(store.dashboard())
        await task.queue_frames([LLMRunFrame()])
    @transport.event_handler('on_client_disconnected')
    async def disconnected(*_):
        ws.client=None
        await task.cancel()
    await PipelineRunner(handle_sigint=False).run(task)
