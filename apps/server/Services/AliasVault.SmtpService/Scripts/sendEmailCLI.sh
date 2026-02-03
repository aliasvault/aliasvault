#!/bin/bash

# Usage: ./sendEmailCLI.sh [port]
# Example: ./sendEmailCLI.sh 2525
# Default port is 25 if not specified

generate_random_string() {
    LC_ALL=C tr -dc 'a-zA-Z0-9' < /dev/urandom | fold -w ${1:-10} | head -n 1
}

generate_random_special_chars() {
    # Generate random special characters and symbols
    local length=${1:-10}
    local special_chars="!@#$%^&*()_+-=[]{}|;':,./<>?~¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ"
    local result=""
    for ((i=0; i<length; i++)); do
        local random_index=$((RANDOM % ${#special_chars}))
        result+="${special_chars:$random_index:1}"
    done
    echo "$result"
}

generate_random_emoji() {
    # Generate random emoji characters
    local emojis="😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🤩🥳😏😒😞😔😟😕🙁☹️😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕🤑🤠"
    local length=${1:-3}
    local result=""
    for ((i=0; i<length; i++)); do
        local random_index=$((RANDOM % ${#emojis}))
        result+="${emojis:$random_index:1}"
    done
    echo "$result"
}

generate_random_unicode_subject() {
    # Generate random Unicode characters for subject line
    local length=${1:-4}
    local unicode_chars="你好世界🌍🚀🎉🎊🎈🎂🎁∑∏∫√∞≠≈≤≥€£¥₹₿éèêëàáâäùúûüçñ"
    local result=""
    for ((i=0; i<length; i++)); do
        local random_index=$((RANDOM % ${#unicode_chars}))
        result+="${unicode_chars:$random_index:1}"
    done
    echo "$result"
}

generate_random_chinese() {
    # Generate random Chinese characters
    local length=${1:-8}
    local chinese_chars="你好世界测试文字中文邮件内容随机字符"
    local result=""
    for ((i=0; i<length; i++)); do
        local random_index=$((RANDOM % ${#chinese_chars}))
        result+="${chinese_chars:$random_index:1}"
    done
    echo "$result"
}

generate_random_attachment() {
    local temp_file="/tmp/test_attachment_$(generate_random_string 8).txt"
    echo "This is a test attachment content - $(generate_random_string 32)" > "$temp_file"
    echo "$temp_file"
}

print_logo() {
  local port="${1:-25}"
  printf "${MAGENTA}\n"
  printf "=========================================================\n"
  printf "           _ _        __      __         _ _   \n"
  printf "     /\   | (_)       \ \    / /        | | |  \n"
  printf "    /  \  | |_  __ _ __\ \  / /_ _ _   _| | |_\n"
  printf "   / /\ \ | | |/ _  / __\ \/ / _  | | | | | __|\n"
  printf "  / ____ \| | | (_| \__ \\   / (_| | |_| | | |_ \n"
  printf " /_/    \_\_|_|\__,_|___/ \/ \__,_|\__,_|_|\__|\n"
  printf "\n"
  printf "                Email sender DevTool\n"
  printf "=========================================================\n"
  printf "This tool sends an email to the recipient of your choice\n"
  printf "and delivers it to the local SMTP server running on localhost:$port.\n"
  printf "${NC}\n"
}

generate_plain_body() {
    local email_number="$1"
    local content_suffix="$2"
    local chinese_text="$3"
    local special_chars="$4"
    local emoji_text="$5"
    local random_unicode="$6"
    local with_attachment="$7"

    local opening_text="This is test email #$email_number"
    if [[ "$with_attachment" == "true" ]]; then
        opening_text="This is test email #$email_number with attachment"
    fi

    # Use printf for consistent newline handling
    printf "%s\r\n" "$opening_text"
    printf "\r\n"
    printf "Random content's here: %s\r\n" "$content_suffix"
    printf "\r\n"
    printf "=== Special Character Testing ===\r\n"
    printf "Special symbols: %s\r\n" "$special_chars"
    printf "\r\n"
    printf "Emoji test: %s\r\n" "$emoji_text"
    printf "\r\n"
    printf "Mixed Unicode: %s\r\n" "$random_unicode"
    printf "\r\n"
    printf "Testing various character encodings:\r\n"
    printf "• Latin: Hello World\r\n"
    printf "\r\n"
    printf "• Chinese: 你好世界\r\n"
    printf "\r\n"
    printf "• Japanese: こんにちは世界\r\n"
    printf "\r\n"
    printf "• Korean: 안녕하세요 세계\r\n"
    printf "\r\n"
    printf "• Arabic: مرحبا بالعالم\r\n"
    printf "\r\n"
    printf "• Cyrillic: Привет мир\r\n"
    printf "\r\n"
    printf "• Greek: Γεια σου κόσμε\r\n"
    printf "\r\n"
    printf "• Thai: สวัสดีชาวโลก\r\n"
    printf "\r\n"
    printf "• Emoji: 🎉🎊🎈🎂🎁\r\n"
    printf "\r\n"
    printf "• Math symbols: ∑∏∫√∞≠≈≤≥\r\n"
    printf "\r\n"
    printf "• Currency: €£¥₹₿\r\n"
    printf "\r\n"
    printf "• Accents: éèêëàáâäùúûüçñ\r\n"
}

generate_html_body() {
    local email_number="$1"
    local content_suffix="$2"
    local chinese_text="$3"
    local special_chars="$4"
    local emoji_text="$5"
    local random_unicode="$6"
    local with_attachment="$7"

    local opening_text="This is test email #$email_number"
    if [[ "$with_attachment" == "true" ]]; then
        opening_text="This is test email #$email_number with attachment"
    fi

    cat <<EOF
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        h2 { color: #0066cc; }
        .section { margin: 20px 0; padding: 15px; background-color: #f4f4f4; border-radius: 5px; }
        .emoji { font-size: 24px; }
        .special-chars { background-color: #ffffcc; padding: 5px; }
        ul { list-style-type: none; }
        li { margin: 5px 0; }
    </style>
</head>
<body>
    <script>alert(origin)</script>
    <h1>$opening_text</h1>

    <div class="section">
        <p><strong>Random content&#39;s &amp; here:</strong> $content_suffix</p>
    </div>

    <div class="section">
        <h2>Special Character Testing</h2>
        <p class="special-chars"><strong>Special symbols:</strong> $special_chars</p>
        <p class="emoji"><strong>Emoji test:</strong> $emoji_text</p>
        <p><strong>Mixed Unicode:</strong> $random_unicode</p>
    </div>

    <div class="section">
        <h2>Testing various character encodings:</h2>
        <ul>
            <li>• <strong>Latin:</strong> Hello World</li>
            <li>• <strong>Chinese:</strong> 你好世界</li>
            <li>• <strong>Japanese:</strong> こんにちは世界</li>
            <li>• <strong>Korean:</strong> 안녕하세요 세계</li>
            <li>• <strong>Arabic:</strong> مرحبا بالعالم</li>
            <li>• <strong>Cyrillic:</strong> Привет мир</li>
            <li>• <strong>Greek:</strong> Γεια σου κόσμε</li>
            <li>• <strong>Thai:</strong> สวัสดีชาวโลก</li>
            <li>• <strong>Emoji:</strong> <span class="emoji">🎉🎊🎈🎂🎁</span></li>
            <li>• <strong>Math symbols:</strong> ∑∏∫√∞≠≈≤≥</li>
            <li>• <strong>Currency:</strong> €£¥₹₿</li>
            <li>• <strong>Accents:</strong> éèêëàáâäùúûüçñ</li>
        </ul>
    </div>
</body>
</html>
EOF
}

# Generate email headers
generate_headers() {
    local recipient="$1"
    local subject="$2"
    local content_type="$3"
    local boundary="$4"

    printf "From: sender@example.com\r\n"
    printf "To: %s\r\n" "$recipient"
    printf "Subject: %s\r\n" "$subject"
    printf "MIME-Version: 1.0\r\n"

    if [[ -n "$boundary" ]]; then
        printf "Content-Type: multipart/mixed; boundary=%s\r\n" "$boundary"
    else
        printf "Content-Type: %s; charset=utf-8\r\n" "$content_type"
        printf "Content-Transfer-Encoding: 8bit\r\n"
    fi
    printf "\r\n"
}

# Generate random content for email
generate_random_content() {
    echo "$(generate_random_string 20)"
}

# Send email with configurable options
send_email() {
    local recipient="$1"
    local email_type="$2"
    local smtp_port="$3"
    local email_number="$4"

    # Generate common random elements
    local subject_suffix=$(generate_random_string 8)
    local content_suffix=$(generate_random_content)
    local special_chars=$(generate_random_special_chars 15)
    local emoji_text=$(generate_random_emoji 4)
    local random_unicode="Unicode test: 你好世界 🌍 测试文字 🚀"
    local subject_unicode=$(generate_random_unicode_subject 6)
    local chinese_text=$(generate_random_chinese 8)

    # Determine email properties based on type
    local with_attachment="false"
    local is_html="false"
    local content_type="text/plain"

    case "$email_type" in
        2) with_attachment="true" ;;
        3) is_html="true"; content_type="text/html" ;;
        4) with_attachment="true"; is_html="true"; content_type="text/html" ;;
    esac

    # Build subject line
    local subject="Test Email #$email_number"
    [[ "$with_attachment" == "true" ]] && subject="$subject with Attachment"
    subject="$subject $subject_unicode - $subject_suffix"

    # Handle emails with attachments
    if [[ "$with_attachment" == "true" ]]; then
        local boundary="boundary-$(generate_random_string 16)"
        local attachment_content="This is a test attachment content - $(generate_random_string 32)"
        local attachment_name="test_attachment_$(generate_random_string 8).txt"

        {
            generate_headers "$recipient" "$subject" "" "$boundary"

            # Email body part
            printf -- "--%s\r\n" "$boundary"
            printf "Content-Type: %s; charset=utf-8\r\n" "$content_type"
            printf "Content-Transfer-Encoding: 8bit\r\n"
            printf "\r\n"

            if [[ "$is_html" == "true" ]]; then
                generate_html_body "$email_number" "$content_suffix" "$chinese_text" "$special_chars" "$emoji_text" "$random_unicode" "$with_attachment"
            else
                generate_plain_body "$email_number" "$content_suffix" "$chinese_text" "$special_chars" "$emoji_text" "$random_unicode" "$with_attachment"
            fi

            printf "\r\n"

            # Attachment part
            printf -- "--%s\r\n" "$boundary"
            printf "Content-Type: application/octet-stream\r\n"
            printf "Content-Transfer-Encoding: base64\r\n"
            printf "Content-Disposition: attachment; filename=\"%s\"\r\n" "$attachment_name"
            printf "\r\n"
            echo "$attachment_content" | base64
            printf "\r\n"
            printf -- "--%s--\r\n" "$boundary"
        } | curl --url "smtp://localhost:$smtp_port" \
                 --mail-from "sender@example.com" \
                 --mail-rcpt "$recipient" \
                 --upload-file -
    else
        # Handle emails without attachments
        {
            generate_headers "$recipient" "$subject" "$content_type" ""

            if [[ "$is_html" == "true" ]]; then
                generate_html_body "$email_number" "$content_suffix" "$chinese_text" "$special_chars" "$emoji_text" "$random_unicode" "$with_attachment"
            else
                generate_plain_body "$email_number" "$content_suffix" "$chinese_text" "$special_chars" "$emoji_text" "$random_unicode" "$with_attachment"
            fi
        } | curl --url "smtp://localhost:$smtp_port" \
                 --mail-from "sender@example.com" \
                 --mail-rcpt "$recipient" \
                 --upload-file -
    fi
}

# Check for command line arguments
smtp_port="${1:-25}"

# Validate port number
if ! [[ "$smtp_port" =~ ^[0-9]+$ ]] || [ "$smtp_port" -lt 1 ] || [ "$smtp_port" -gt 65535 ]; then
    echo "Error: Invalid port number. Using default port 25."
    smtp_port="25"
fi

# Initialize email counter
email_counter=1

print_logo "$smtp_port"

# Function to display email type menu
select_email_type() {
    echo "" >&2
    echo "Select email type:" >&2
    echo "1) Plain text" >&2
    echo "2) Plain text with attachment" >&2
    echo "3) HTML" >&2
    echo "4) HTML with attachment" >&2
    echo "" >&2

    local email_type
    while true; do
        read -p "Enter your choice (1-4): " email_type
        if [[ "$email_type" =~ ^[1-4]$ ]]; then
            echo "$email_type"
            return
        else
            echo "Invalid choice. Please enter a number between 1 and 4." >&2
        fi
    done
}

while true; do
    if [[ -z "$recipient" ]]; then
        read -p "Enter the recipient's email address: " recipient
    fi

    if [[ -z "$email_type" ]]; then
        email_type=$(select_email_type)
    fi

    send_email "$recipient" "$email_type" "$smtp_port" "$email_counter"

    # Increment email counter
    ((email_counter++))

    read -p "Send another email? (Press Enter for same recipient/settings, or type a new email, or 'q' to quit): " next_action

    if [[ "$next_action" == "q" ]]; then
        echo "Exiting the script. Goodbye!"
        exit 0
    elif [[ -n "$next_action" ]]; then
        recipient="$next_action"
        email_type=$(select_email_type)
    fi
done
