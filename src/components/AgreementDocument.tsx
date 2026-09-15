export function AgreementDocument({ markdown }: { markdown: string }) {
  return (
    <div className="legal">
      {markdown.split(/\n{2,}/).map((block, index) => {
        const content = block.trim();
        if (!content) return null;
        if (content.startsWith("## ")) {
          return <h2 key={index}>{content.slice(3)}</h2>;
        }
        return <p key={index}>{content}</p>;
      })}
    </div>
  );
}
