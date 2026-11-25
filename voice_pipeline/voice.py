import os,json
import aiohttp
from datetime import date
from pipecat.frames.frames import AudioRawFrame, InputAudioRawFrame, OutputAudioRawFrame, TranscriptionFrame, TextFrame, LLMRunFrame, StartInterruptionFrame
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.transports.websocket.server import WebsocketServerTransport, WebsocketServerParams
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask, PipelineParams
from pipecat.pipeline.runner import PipelineRunner
from pipecat.services.elevenlabs.stt import ElevenLabsSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.processors.frame_processor import FrameProcessor
import store
class PCMSerializer(FrameSerializer):
    async def serialize(self, frame):
        if isinstance(frame,OutputAudioRawFrame): return frame.audio
        if isinstance(frame,StartInterruptionFrame): return json.dumps({'type':'interrupt'})
        return None
    async def deserialize(self,data):
        if isinstance(data,bytes): return InputAudioRawFrame(audio=data,sample_rate=16000,num_channels=1)
        return None
    async def setup(self,frame): pass
    @property
    def type(self): return FrameSerializer.FrameSerializerType.BINARY if hasattr(FrameSerializer,'FrameSerializerType') else 'binary'
class Transcript(FrameProcessor):
    def __init__(self,ws,role): super().__init__(); self.ws=ws; self.role=role
    async def process_frame(self,frame,direction):
        await super().process_frame(frame,direction)
        if (self.role=='caller' and isinstance(frame,TranscriptionFrame)) or (self.role=='assistant' and isinstance(frame,TextFrame) and not isinstance(frame,TranscriptionFrame)):
            await self.ws.send_json({'type':'transcript','role':self.role,'text':frame.text})
        await self.push_frame(frame,direction)
async def run_voice(ws):
    async with aiohttp.ClientSession() as session:
        await run_voice_pipeline(ws, session)

async def run_voice_pipeline(ws, session):
    transport=WebsocketServerTransport(host="127.0.0.1",port=8765,params=WebsocketServerParams(audio_in_enabled=True,audio_out_enabled=True,add_wav_header=False,serializer=PCMSerializer(),vad_analyzer=SileroVADAnalyzer()))
    stt = ElevenLabsSTTService(
        api_key=os.environ['ELEVENLABS_API_KEY'],
        aiohttp_session=session
    )
    tts=ElevenLabsTTSService(api_key=os.environ['ELEVENLABS_API_KEY'],voice_id=os.getenv('ELEVENLABS_VOICE_ID','21m00Tcm4TlvDq8ikWAM'))
    llm=GoogleLLMService(api_key=os.environ['GOOGLE_API_KEY'],model=os.getenv('GEMINI_MODEL','gemini-2.5-flash'))
    def schema(name,description,props,required): return FunctionSchema(name=name,description=description,properties=props,required=required)
    string={'type':'string'}; integer={'type':'integer'}; boolean={'type':'boolean'}
    tools=ToolsSchema(standard_tools=[schema('check_doctor_availability','Find open slots by doctor or specialty and optional ISO date',{'doctor':string,'day':string},[]),schema('book_appointment','Book only after reading phone back and receiving explicit confirmation',{'slot_id':integer,'phone':string,'confirmed':boolean},['slot_id','phone','confirmed']),schema('cancel_appointment','Cancel only after confirming spoken phone and intended cancellation; appointment_id optional',{'phone':string,'confirmed':boolean,'appointment_id':integer},['phone','confirmed'])])
    async def check(p): await p.result_callback({'slots':store.availability(**p.arguments)[:15]})
    async def mutate(p,fn):
        args=dict(p.arguments)
        if not args.pop('confirmed',False): await p.result_callback({'error':'Confirm spoken phone first'}); return
        try: result=fn(**args)
        except ValueError as e: result={'error':str(e)}
        await ws.send_json(store.dashboard())
        await p.result_callback(result)
    async def book(p): await mutate(p,store.book)
    async def cancel(p): await mutate(p,store.cancel)
    for name,fn in [('check_doctor_availability',check),('book_appointment',book),('cancel_appointment',cancel)]: llm.register_function(name,fn)
    context=OpenAILLMContext([{'role':'system','content':f'You are Careline, a friendly appointment receptionist. Today is {date.today()} in India. Greet briefly. Only schedule appointments; no medical advice. Ask the caller to speak their 10 digit phone number, read each digit back, and wait for explicit confirmation before booking or cancelling. Never guess phone numbers, dates or slot IDs. Use tools for every availability check and mutation. Ask which appointment if multiple. Never claim success unless tool succeeded. Offer a few slots, speak concise natural English. Confirm selected slot before booking and intended cancellation before cancelling.'}],tools=tools)
    agg=llm.create_context_aggregator(context)
    task=PipelineTask(Pipeline([transport.input(),stt,Transcript(ws,'caller'),agg.user(),llm,Transcript(ws,'assistant'),tts,transport.output(),agg.assistant()]),params=PipelineParams(audio_in_sample_rate=16000,audio_out_sample_rate=24000,allow_interruptions=True))
    @transport.event_handler('on_client_connected')
    async def connected(transport, client):
        ws.client=client
        await ws.send_json({'type':'ready'})
        await ws.send_json(store.dashboard())
        await task.queue_frames([LLMRunFrame()])
    @transport.event_handler('on_client_disconnected')
    async def disconnected(*_): await task.cancel()
    await PipelineRunner(handle_sigint=False).run(task)
