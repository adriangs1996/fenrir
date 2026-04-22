interface Props {
  sessionType: string;
}

export function TargetFilesTab({ sessionType }: Props) {
  if (sessionType !== "meterpreter") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Available after Meterpreter upgrade
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      File browser — coming soon
    </div>
  );
}
