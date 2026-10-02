import * as Speech from 'expo-speech';

import { compareLabels } from '@/lib/compare-labels';

export type SpeechVoiceOption = {
  id: string;
  label: string;
  language: string;
};

let audioModeInitialized = false;
let audioModulePromise: Promise<typeof import('expo-audio') | null> | null = null;
let duckingActive = false;
let voiceIdsPromise: Promise<Set<string> | undefined> | undefined;

// Tracks the utterance the app is currently speaking so a missing callback
// (notably on iOS, which never emits the speech error event) cannot hang callers
// such as conversation mode.
type PendingSpeech = {
  finished: boolean;
  started: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

let pendingSpeech: PendingSpeech | undefined;

function getVoiceAudioMode(duckOthers: boolean): Partial<import('expo-audio').AudioMode> {
  return {
    allowsRecording: false,
    interruptionMode: duckOthers ? 'duckOthers' : 'mixWithOthers',
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    shouldRouteThroughEarpiece: false,
  };
}

async function getAudioModuleAsync() {
  if (!audioModulePromise) {
    audioModulePromise = import('expo-audio')
      .then((module) => module)
      .catch(() => null);
  }

  return audioModulePromise;
}

export async function initializeVoiceAudioAsync() {
  if (audioModeInitialized) {
    return;
  }

  const audioModule = await getAudioModuleAsync();
  if (!audioModule) {
    return;
  }

  await audioModule.setAudioModeAsync(getVoiceAudioMode(false));

  audioModeInitialized = true;
}

async function activateVoiceDuckingAsync() {
  const audioModule = await getAudioModuleAsync();
  if (!audioModule) {
    return;
  }

  await initializeVoiceAudioAsync();
  if (duckingActive) {
    return;
  }

  await audioModule.setAudioModeAsync(getVoiceAudioMode(true));
  duckingActive = true;
}

async function deactivateVoiceDuckingAsync() {
  const audioModule = await getAudioModuleAsync();
  if (!audioModule) {
    return;
  }

  await initializeVoiceAudioAsync();
  if (!duckingActive) {
    return;
  }

  await audioModule.setAudioModeAsync(getVoiceAudioMode(false));
  duckingActive = false;
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function getSpeakableText(text: string) {
  return compactWhitespace(
    text
      .replace(/```[\s\S]*?```/g, ' code block omitted ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+\.\s+/gm, ''),
  );
}

async function getAvailableVoiceIds() {
  if (!voiceIdsPromise) {
    voiceIdsPromise = Speech.getAvailableVoicesAsync()
      .then((voices) => new Set(voices.map((voice) => voice.identifier)))
      .catch(() => {
        voiceIdsPromise = undefined;
        return undefined;
      });
  }

  return voiceIdsPromise;
}

// A saved voice id can disappear (OS update, removed download). The native
// synth would then throw without ever invoking a callback, so resolve to the
// system default instead when the id is no longer present.
async function resolveSpeechVoice(voiceId?: string) {
  if (!voiceId) {
    return undefined;
  }

  const ids = await getAvailableVoiceIds();
  if (ids && !ids.has(voiceId)) {
    // Fall back to the system default voice rather than risk a silent failure.
    return undefined;
  }

  return voiceId;
}

export async function getSpeechVoiceOptions() {
  const voices = await Speech.getAvailableVoicesAsync();

  return voices
    .map((voice) => ({
      id: voice.identifier,
      label: `${voice.name} (${voice.language})`,
      language: voice.language,
    }))
    .sort((left, right) => compareLabels(left.label, right.label));
}

// Generous upper bound for one utterance: roughly 9 characters per second at
// normal rate, scaled by the configured rate and with a 5s floor, so slow
// playback is not cut off but a stalled synth still resolves.
function estimateSpeechDurationMs(text: string, rate?: number) {
  const effectiveRate = Math.max(0.25, rate ?? 1);
  const base = text.length * 110 + 2500;
  return Math.min(300000, Math.max(5000, Math.round(base / effectiveRate)));
}

function clearPending(record: PendingSpeech) {
  if (record.timer) {
    clearTimeout(record.timer);
    record.timer = undefined;
  }
  if (pendingSpeech === record) {
    pendingSpeech = undefined;
  }
}

export async function speakText({
  language,
  onDone,
  onError,
  onStart,
  rate,
  text,
  voice,
}: {
  text: string;
  language?: string;
  rate?: number;
  voice?: string;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}) {
  const speakableText = getSpeakableText(text);
  if (!speakableText) {
    return false;
  }

  await activateVoiceDuckingAsync().catch(() => undefined);
  await Speech.stop().catch(() => undefined);
  // A superseded utterance settles without callbacks; the new one owns the
  // completion contract from here on.
  const previous = pendingSpeech;
  if (previous) {
    previous.finished = true;
    clearPending(previous);
  }

  const resolvedVoice = await resolveSpeechVoice(voice);
  const record: PendingSpeech = { finished: false, started: false };

  const finish = (error?: Error) => {
    if (record.finished) {
      return;
    }

    record.finished = true;
    clearPending(record);
    void deactivateVoiceDuckingAsync().catch(() => undefined);
    if (error) {
      onError?.(error);
    } else {
      onDone?.();
    }
  };

  const armWatchdog = () => {
    if (record.timer) {
      clearTimeout(record.timer);
    }
    record.timer = setTimeout(() => {
      void Speech.stop().catch(() => undefined);
      finish(new Error('Speech playback timed out.'));
    }, record.started ? estimateSpeechDurationMs(speakableText, rate) : 5000);
  };

  pendingSpeech = record;
  armWatchdog();

  Speech.speak(speakableText, {
    language,
    onDone: () => finish(),
    onError: (error) => finish(error instanceof Error ? error : new Error('Speech playback failed.')),
    onStart: () => {
      record.started = true;
      armWatchdog();
      onStart?.();
    },
    onStopped: () => finish(),
    rate,
    voice: resolvedVoice,
  });

  return true;
}

export async function stopSpeaking() {
  await Speech.stop().catch(() => undefined);
  const record = pendingSpeech;
  if (record && !record.finished) {
    record.finished = true;
    clearPending(record);
  }
  await deactivateVoiceDuckingAsync().catch(() => undefined);
}
