import type { ScopedOpencodeClient, PendingQuestionAnswer, PendingQuestionRequest } from './types';

export async function listPendingInteractions(client: ScopedOpencodeClient) {
  // Fetch each surface independently. A V2 server can reject an unscoped form or
  // permission list while the other endpoint still works; coupling them behind a
  // single Promise.all would hide working interactions behind one failing call.
  const [permissionResult, questionResult] = await Promise.allSettled([
    client.permission.list(),
    client.question.list(),
  ]);

  const permissions = permissionResult.status === 'fulfilled' ? permissionResult.value.data : undefined;
  const questions = questionResult.status === 'fulfilled' ? questionResult.value.data : undefined;

  if (!permissions && !questions) {
    const reason = permissionResult.status === 'rejected'
      ? permissionResult.reason
      : questionResult.status === 'rejected'
        ? questionResult.reason
        : undefined;
    throw reason instanceof Error ? reason : new Error('OpenCode did not return pending interactions.');
  }

  return {
    permissions: permissions ?? [],
    questions: (questions ?? []) as PendingQuestionRequest[],
  };
}

export async function replyToPendingPermission(
  client: ScopedOpencodeClient,
  requestID: string,
  reply: 'once' | 'always' | 'reject',
) {
  await client.permission.reply({ requestID, reply });
}

export async function replyToPendingQuestion(client: ScopedOpencodeClient, requestID: string, answers: PendingQuestionAnswer[]) {
  await client.question.reply({ requestID, answers });
}

export async function rejectPendingQuestion(client: ScopedOpencodeClient, requestID: string) {
  await client.question.reject({ requestID });
}
