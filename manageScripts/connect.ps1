$CWMConnectionInfo = @{
    # This is the URL to your manage server.
    Server      = 'portal.resultant.com'
    # This is the company entered at login
    Company     = 'resultant'
    # Public key created for this integration
    pubkey      = 'Jtwf9WGnSkv5lhFT'
    # Private key created for this integration
    privatekey  = '6Uvpq3krP9dPeQW7'
    # Your ClientID found at https://developer.connectwise.com/ClientID
    clientid    = '7cbdcad9-0ad6-4b82-bcd9-31221288c868'
}
# ^This information is sensitive, take precautions to secure it.^

# Install/Update/Load the module
#if(Get-InstalledModule 'ConnectWiseManageAPI' -ErrorAction SilentlyContinue){ Update-Module 'ConnectWiseManageAPI' -Verbose }
#else{ Install-Module 'ConnectWiseManageAPI' -Verbose }
Import-Module 'ConnectWiseManageAPI'

# Connect to your Manage server
Connect-CWM @CWMConnectionInfo -Force -Verbose