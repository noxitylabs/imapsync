#!/bin/bash

domain="$1"

# Fetch MX record
mx_host=$(dig +short MX "$domain" | awk '{print $2}' | sed 's/\.$//')

# Convert to lowercase to allow case-insensitive matching
mx_host_lower=$(echo "$mx_host" | tr '[:upper:]' '[:lower:]')

# Fetch SRV
imap_srv=$(dig +short _imaps._tcp."$domain" SRV | awk '{print $4}' | sed 's/\.$//')

print_result() {
    echo $1;
}

# Check known providers
case "$mx_host_lower" in
    *google.com)
        if [[ "${domain}" == "gmail.com" ]]; then
            print_result "imap.gmail.com" "gmail"
        else
            print_result "imap.gmail.com" "googleWorkspace"
        fi
        exit 0
    ;;
    *outlook.com|*office365.com|*hotmail.com|*live.com|*me.com)
        print_result "outlook.office365.com" "microsoftOutlookHotmailLive"
        exit 0
    ;;
    *yahoo.com)
        print_result "imap.mail.yahoo.com" "yahoo"
        exit 0
    ;;
    *icloud.com|*apple.com)
        print_result "imap.mail.me.com" "appleIcloud"
        exit 0
    ;;
    *)
        # If no known provider, check for SRV or other records
        {
            dig +short CNAME imap.$domain;
            dig +short A imap.$domain;
            dig +short A mail.$domain;
            dig +short A autoconfig.$domain;
            dig +short A autodiscover.$domain;
            dig +short SRV _imap._tcp.$domain | awk '{print $NF}';
            dig +short SRV _imaps._tcp.$domain | awk '{print $NF}';
            dig +short SRV _autodiscover._tcp.$domain | awk '{print $NF}';
        } | sort -u | while read host; do
            if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                ip="$host"
            else
                ip=$(dig +short "$host")
            fi

            if [[ -n "$ip" ]]; then
                ptr=$(dig +short -x "$ip" | sed 's/\.$//' | head -n 1)

                if [[ -n "$ptr" ]]; then
                    print_result "$ptr" "custom"
                    exit 0
                fi
            fi
        done

        # If no matches, return unknown only if nothing else was found
        exit 0
    ;;
esac
