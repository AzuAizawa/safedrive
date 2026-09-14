/** The red line under a field that says what is wrong with it. Renders nothing when it is fine. */
export default function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-xs font-medium text-destructive">{message}</p>;
}
