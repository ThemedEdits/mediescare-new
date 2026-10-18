; Extra installer steps for Mediescare (included by electron-builder's NSIS script).
; The main computer of a branch serves the shop network on TCP 47800 and answers discovery on UDP 47801.
; Windows Firewall rules need administrator rights: they are added for an "all users" install; for a "just me" install
; Windows asks once the first time the shop network service starts.

!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mediescare shop network (TCP)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mediescare shop network (UDP)"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mediescare shop network (TCP)" dir=in action=allow protocol=TCP localport=47800 profile=private,domain'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Mediescare shop network (UDP)" dir=in action=allow protocol=UDP localport=47801 profile=private,domain'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mediescare shop network (TCP)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Mediescare shop network (UDP)"'
!macroend
