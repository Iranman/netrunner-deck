# Continuous resource sampler for the Claude session that launched this script.
# Every ~3 s prints one JSON line: cpu (100ns ticks summed over claude.exe and all its
# descendants, minus this script), ram (bytes), gpu (% system 3D), cores, t (unix ms).
# The deck turns the cpu tick delta into a percentage.
$cores = [Environment]::ProcessorCount

function Sample([double]$gpu) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, WorkingSetSize, KernelModeTime, UserModeTime
  $byId = @{}; $kids = @{}
  foreach ($p in $all) {
    $byId[[int]$p.ProcessId] = $p
    $pp = [int]$p.ParentProcessId
    if (-not $kids.ContainsKey($pp)) { $kids[$pp] = New-Object System.Collections.ArrayList }
    [void]$kids[$pp].Add([int]$p.ProcessId)
  }
  $root = $PID
  while ($byId.ContainsKey($root) -and $byId[$root].Name -ne 'claude.exe') {
    $parent = [int]$byId[$root].ParentProcessId
    if ($parent -eq $root -or -not $byId.ContainsKey($parent)) { $root = 0; break }
    $root = $parent
  }
  $cpu = [int64]0; $ram = [int64]0
  if ($root) {
    $stack = New-Object System.Collections.Stack; $stack.Push($root)
    while ($stack.Count) {
      $id = $stack.Pop()
      if ($id -eq $PID) { continue }
      $p = $byId[$id]
      $cpu += [int64]$p.KernelModeTime + [int64]$p.UserModeTime
      $ram += [int64]$p.WorkingSetSize
      if ($kids.ContainsKey($id)) { foreach ($k in $kids[$id]) { $stack.Push($k) } }
    }
  }
  $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  [Console]::Out.WriteLine(('{{"cpu":{0},"ram":{1},"gpu":{2},"cores":{3},"t":{4}}}' -f $cpu, $ram, $gpu, $cores, $t))
  [Console]::Out.Flush()
}

Sample -1
try {
  # ponytail: GPU instances are fixed when the counter starts; a process that starts using
  # the GPU later is missed until the deck restarts the sampler (session start / reload).
  Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -SampleInterval 3 -Continuous -ErrorAction Stop |
    ForEach-Object { Sample ([Math]::Min(100, [Math]::Round(($_.CounterSamples | Measure-Object CookedValue -Sum).Sum, 1))) }
} catch {
  while ($true) { Start-Sleep -Seconds 3; Sample -1 }
}
