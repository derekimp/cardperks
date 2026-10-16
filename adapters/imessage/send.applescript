-- Sends one iMessage. Arguments are passed as argv rather than interpolated
-- into a shell string, so message text can contain quotes safely.
on run argv
	if (count of argv) < 2 then error "usage: send.applescript <handle> <text>"
	set targetHandle to item 1 of argv
	set messageText to item 2 of argv
	tell application "Messages"
		try
			set targetService to 1st account whose service type = iMessage
			send messageText to participant targetHandle of targetService
		on error
			-- Fall back to SMS relay for handles with no iMessage account.
			send messageText to buddy targetHandle of service "SMS"
		end try
	end tell
end run
