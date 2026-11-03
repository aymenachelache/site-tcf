export async function requestExamFullscreen(): Promise<boolean> {
  const target = document.getElementById("exam-root") ?? document.documentElement;

  if (!target.requestFullscreen) return false;

  try {
    await target.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}
