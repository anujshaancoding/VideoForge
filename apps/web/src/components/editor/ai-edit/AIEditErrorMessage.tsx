export default function AIEditErrorMessage({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div className="rounded border border-red-500/40 bg-red-950/30 px-3 py-2 text-xs text-red-100">
      {messages.map((message) => (
        <div key={message}>{message}</div>
      ))}
    </div>
  );
}
