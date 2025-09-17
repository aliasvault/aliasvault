#!/bin/bash
# @version 0.23.0

# Repository information used for downloading files and images from GitHub
REPO_OWNER="aliasvault"
REPO_NAME="aliasvault"
GITHUB_RAW_URL_REPO="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}"
GITHUB_CONTAINER_REGISTRY="ghcr.io/$(echo "$REPO_OWNER" | tr '[:upper:]' '[:lower:]')"

# Required files and directories
REQUIRED_DIRS=(
    "certificates/ssl"
    "certificates/letsencrypt"
    "certificates/letsencrypt/www"
    "database"
    "database/postgres"
    "logs"
    "logs/msbuild"
    "secrets"
)

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
MAGENTA='\033[0;35m'
ORANGE='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# File paths
ENV_FILE=".env"
ENV_EXAMPLE_FILE=".env.example"
SECRETS_DIR="./secrets"

# Minimum required versions
MIN_DOCKER_VERSION="20.10.0"
MIN_COMPOSE_VERSION="2.0.0"
MIN_DISK_SPACE_GB=5

# Global cache for latest version to avoid rate limiting
CACHED_LATEST_VERSION=""

# Function to show usage
show_usage() {
    print_logo
    printf "Usage: $0 [COMMAND] [OPTIONS]\n"
    printf "\n"
    printf "Commands:\n"
    printf "  install                   Install AliasVault by pulling pre-built images from GitHub Container Registry (recommended)\n"
    printf "  build                     Build AliasVault containers locally from source (takes longer and requires sufficient specs)\n"
    printf "  start                     Start AliasVault containers\n"
    printf "  restart                   Restart AliasVault containers\n"
    printf "  stop                      Stop AliasVault containers\n"
    printf "\n"
    printf "  configure-hostname        Configure the hostname where AliasVault can be accessed from\n"
    printf "  configure-ssl             Configure SSL certificates (Let's Encrypt or self-signed)\n"
    printf "  configure-email           Configure email domains for receiving emails\n"
    printf "  configure-registration    Configure new account registration (enable or disable)\n"
    printf "  configure-ip-logging      Configure IP address logging (enable or disable)\n"
    printf "  reset-admin-password      Reset admin password\n"
    printf "  uninstall                 Uninstall AliasVault\n"
    printf "\n"
    printf "  update                    Update AliasVault including install.sh script to the latest version\n"
    printf "  update-installer          Update install.sh script if newer version is available\n"
    printf "\n"
    printf "  db-export                 Export database to file\n"
    printf "  db-import                 Import database from file\n"
    printf "\n"
    printf "  configure-dev-db          Enable/disable development database (for local development only)\n"
    printf "\n"
    printf "Options:\n"
    printf "  --verbose         Show detailed output\n"
    printf "  -y, --yes         Automatic yes to prompts\n"
    printf "  --dev             Target development database for db import/export operations"
    printf "\n"
}

# Function to print the logo
print_logo() {
    printf "${MAGENTA}" >&2
    printf "==================================================\n" >&2
    printf "    _    _ _           __      __         _ _   \n" >&2
    printf "   / \  | (_) __ _ ___ \ \    / /_ _ _   _| | |_\n" >&2
    printf "  / _ \ | | |/ _\` / __| \ \/\/ / _\` | | | | | __|\n" >&2
    printf " / ___ \| | | (_| \__ \  \  / / (_| | |_| | | |_ \n" >&2
    printf "/_/   \_\_|_|\__,_|___/   \/  \__,__|\__,_|_|\__|\n" >&2
    printf "\n" >&2
    printf "==================================================\n${NC}" >&2
}

# Function to parse command line arguments
parse_args() {
    COMMAND=""
    VERBOSE=false
    FORCE_YES=false
    COMMAND_ARG=""
    DEV_DB=false

    if [ $# -eq 0 ]; then
        show_usage
        exit 0
    fi

    # First argument is always the command
    case $1 in
        install|i)
            COMMAND="install"
            shift
            # Check for version argument
            if [ $# -gt 0 ] && [[ ! "$1" =~ ^- ]]; then
                COMMAND_ARG="$1"
                shift
            fi
            ;;
        build|b)
            COMMAND="build"
            shift
            # Check for additional operation argument
            if [ $# -gt 0 ] && [[ ! "$1" =~ ^- ]]; then
                case $1 in
                    start|stop|restart)
                        COMMAND_ARG="$1"
                        shift
                        ;;
                    *)
                        echo "Invalid build operation: $1"
                        echo "Valid operations are: start, stop, restart"
                        exit 1
                        ;;
                esac
            fi
            ;;
        uninstall|u)
            COMMAND="uninstall"
            shift
            ;;
        reset-password|reset-admin-password|rp)
            COMMAND="reset-admin-password"
            shift
            ;;
        configure-hostname|hostname)
            COMMAND="configure-hostname"
            shift
            ;;
        configure-ssl|ssl)
            COMMAND="configure-ssl"
            shift
            ;;
        configure-email|email)
            COMMAND="configure-email"
            shift
            ;;
        configure-registration|registration)
            COMMAND="configure-registration"
            shift
            ;;
        configure-ip-logging|ip-logging)
            COMMAND="configure-ip-logging"
            shift
            ;;
        start|s)
            COMMAND="start"
            shift
            ;;
        stop|st)
            COMMAND="stop"
            shift
            ;;
        restart|r)
            COMMAND="restart"
            shift
            ;;
        update|up)
            COMMAND="update"
            shift
            ;;
        update-installer|cs)
            COMMAND="update-installer"
            shift
            ;;
        configure-dev-db|dev-db)
            COMMAND="configure-dev-db"
            shift
            # Check for direct option argument
            if [ $# -gt 0 ] && [[ ! "$1" =~ ^- ]]; then
                COMMAND_ARG="$1"
                shift
            fi
            ;;
        migrate-db|migrate)
            COMMAND="migrate-db"
            shift
            ;;
        db-export)
            COMMAND="db-export"
            shift
            ;;
        db-import)
            COMMAND="db-import"
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac

    # Parse remaining flags
    while [[ $# -gt 0 ]]; do
        case $1 in
            --verbose)
                VERBOSE=true
                shift
                ;;
            -y|--yes)
                FORCE_YES=true
                shift
                ;;
            --dev)
                DEV_DB=true
                shift
                ;;
            *)
                echo "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
}

# Progress and animation functions
show_spinner() {
    local pid=$1
    local message="$2"
    local delay=0.1
    local spinstr='|/-\\'
    local i=0

    printf "${CYAN}ℹ %s${NC} " "$message"

    while kill -0 "$pid" 2>/dev/null; do
        printf "\b%c" "${spinstr:$i:1}"
        sleep $delay
        ((i = (i + 1) % 4))
    done

    printf "\b ${GREEN}✓${NC}\n"
}

log_info() {
    printf "${CYAN}ℹ ${NC}%s\n" "$1"
}

log_warning() {
    printf "${YELLOW}⚠ ${NC}%s\n" "$1"
}

log_error() {
    printf "${RED}✗ ${NC}%s\n" "$1" >&2
}

# Version comparison function
version_ge() {
    test "$(printf '%s\n' "$@" | sort -V | head -n 1)" != "$1"
}

# Network connectivity check
check_connectivity() {
    printf "${CYAN}ℹ Checking network connectivity...${NC} "

    local test_urls=(
        "https://api.github.com"
        "https://raw.githubusercontent.com"
        "https://ghcr.io"
    )

    local spinstr='|/-\\'
    local i=0

    for url in "${test_urls[@]}"; do
        printf "\b%c" "${spinstr:$i:1}"
        ((i = (i + 1) % 4))

        if ! curl -Ls --connect-timeout 10 --max-time 30 "$url" > /dev/null 2>&1; then
            printf "\b ${RED}✗${NC}\n"
            log_error "Cannot reach $url. Please check your internet connection."
            return 1
        fi
    done

    printf "\b ${GREEN}✓${NC}\n"
    return 0
}

# Disk space check
check_disk_space() {
    printf "${CYAN}ℹ Checking disk space...${NC} "

    local available_gb=""
    local spinstr='|/-\\'
    local i=0

    if command -v df >/dev/null 2>&1; then
        printf "\b%c" "${spinstr:$i:1}"
        ((i = (i + 1) % 4))

        # Use portable df command and parse available size in KB
        local available_kb
        available_kb=$(df -k . 2>/dev/null | awk 'NR==2 {print $4}')

        if [ -n "$available_kb" ] && [ "$available_kb" -gt 0 ] 2>/dev/null; then
            available_gb=$((available_kb / 1024 / 1024))
        fi

        if [ -n "$available_gb" ] && [ "$available_gb" -gt 0 ] 2>/dev/null; then
            if [ "$available_gb" -lt "$MIN_DISK_SPACE_GB" ]; then
                printf "\b ${RED}✗${NC}\n"
                log_error "Insufficient disk space. Required: ${MIN_DISK_SPACE_GB}GB, Available: ${available_gb}GB"
                return 1
            fi
            printf "\b ${GREEN}✓${NC}\n"
            printf "  ${GREEN}✓ Disk space verified (${available_gb}GB available)${NC}\n"
        else
            printf "\b ${YELLOW}⚠${NC}\n"
            log_warning "Cannot determine available disk space, skipping check"
        fi
    else
        printf "\b ${YELLOW}⚠${NC}\n"
        log_warning "Cannot check disk space (df command not available)"
    fi

    return 0
}

# Read port configuration from .env file with fallbacks
get_port_config() {
    local http_port=80
    local https_port=443
    local smtp_port=25

    if [ -f "$ENV_FILE" ]; then
        # Read ports from .env file if it exists
        local env_http_port
        local env_https_port
        local env_smtp_port

        env_http_port=$(grep -E "^HTTP_PORT=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | tr -d ' ')
        env_https_port=$(grep -E "^HTTPS_PORT=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | tr -d ' ')
        env_smtp_port=$(grep -E "^SMTP_PORT=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2 | tr -d ' ')

        # Use .env values if they're valid numbers
        if [[ "$env_http_port" =~ ^[0-9]+$ ]] && [ "$env_http_port" -gt 0 ] && [ "$env_http_port" -le 65535 ]; then
            http_port="$env_http_port"
        fi
        if [[ "$env_https_port" =~ ^[0-9]+$ ]] && [ "$env_https_port" -gt 0 ] && [ "$env_https_port" -le 65535 ]; then
            https_port="$env_https_port"
        fi
        if [[ "$env_smtp_port" =~ ^[0-9]+$ ]] && [ "$env_smtp_port" -gt 0 ] && [ "$env_smtp_port" -le 65535 ]; then
            smtp_port="$env_smtp_port"
        fi
    fi

    # Return the ports as space-separated values
    echo "$http_port $https_port $smtp_port"
}

# Check if ports are available (not in use by non-AliasVault processes)
check_port_availability() {
    create_env_file || { printf "${RED}> Failed to create .env file${NC}\n"; exit 1; }

    printf "${CYAN}ℹ Checking port availability...${NC} "

    local ports_config
    ports_config=$(get_port_config)
    read -r http_port https_port smtp_port <<< "$ports_config"

    local ports_to_check=("$http_port" "$https_port" "$smtp_port")
    local port_issues=()
    local has_issues=false
    local spinstr='|/-\\'
    local i=0

    # Get current directory name as potential project name
    local current_project_name
    current_project_name=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')

    # Get list of running AliasVault containers to exclude from checks
    local aliasvault_containers=()
    local aliasvault_project_containers=()

    if command -v docker > /dev/null 2>&1 && docker info > /dev/null 2>&1; then
        printf "\b%c" "${spinstr:$i:1}"
        ((i = (i + 1) % 4))

        # Get all running containers
        while IFS= read -r container_info; do
            if [ -n "$container_info" ]; then
                # Parse container name and project
                local container_name
                local project_name
                container_name=$(echo "$container_info" | cut -d'|' -f1)
                project_name=$(echo "$container_info" | cut -d'|' -f2)

                # Check if it's an AliasVault container by name or project
                if [[ "$container_name" =~ aliasvault ]] || [[ "$project_name" =~ aliasvault ]] || [[ "$project_name" == "$current_project_name" ]]; then
                    aliasvault_containers+=("$container_name")
                    aliasvault_project_containers+=("$project_name")
                fi
            fi
        done < <(docker ps --format "{{.Names}}|{{.Label \"com.docker.compose.project\"}}" 2>/dev/null | grep -v "^$" || true)
    fi

    for port in "${ports_to_check[@]}"; do
        printf "\b%c" "${spinstr:$i:1}"
        ((i = (i + 1) % 4))

        local port_in_use=false
        local blocking_process=""
        local is_aliasvault_port=false

        # Check if port is in use using netstat/ss
        if command -v ss > /dev/null 2>&1; then
            # Use ss (more modern)
            local ss_output
            ss_output=$(ss -tuln 2>/dev/null | grep ":${port} " || true)
            if [ -n "$ss_output" ]; then
                port_in_use=true
                # Try to get process info
                local process_info
                process_info=$(ss -tulpn 2>/dev/null | grep ":${port} " | head -n1 || true)
                if [ -n "$process_info" ]; then
                    blocking_process=$(echo "$process_info" | sed -n 's/.*users:((\"\([^\"]*\)\".*/\1/p' || true)
                fi
            fi
        elif command -v netstat > /dev/null 2>&1; then
            # Fallback to netstat
            local netstat_output
            netstat_output=$(netstat -tuln 2>/dev/null | grep ":${port} " || true)
            if [ -n "$netstat_output" ]; then
                port_in_use=true
                # Try to get process info with netstat -tulpn if available
                local process_info
                process_info=$(netstat -tulpn 2>/dev/null | grep ":${port} " | head -n1 || true)
                if [ -n "$process_info" ]; then
                    blocking_process=$(echo "$process_info" | awk '{print $7}' | cut -d'/' -f2 || true)
                fi
            fi
        else
            # Last resort: try to bind to the port temporarily
            if command -v nc > /dev/null 2>&1; then
                if ! nc -z localhost "$port" 2>/dev/null; then
                    port_in_use=false
                else
                    port_in_use=true
                fi
            else
                log_warning "Cannot check port $port availability (no netstat, ss, or nc available)"
                continue
            fi
        fi

        # If port is in use, check if it's used by AliasVault containers
        if [ "$port_in_use" = true ]; then
            # First, check if any AliasVault containers are using this port directly
            for container in "${aliasvault_containers[@]}"; do
                if command -v docker > /dev/null 2>&1; then
                    local container_ports
                    container_ports=$(docker port "$container" 2>/dev/null || true)
                    if echo "$container_ports" | grep -q ":${port}$" || echo "$container_ports" | grep -q ":${port}->" ; then
                        is_aliasvault_port=true
                        break
                    fi
                fi
            done

            # If not found in direct container ports, check if it's docker-proxy for AliasVault
            if [ "$is_aliasvault_port" = false ] && [ "$blocking_process" = "docker-proxy" ]; then
                # Check if there are any AliasVault containers running
                if [ ${#aliasvault_containers[@]} -gt 0 ]; then
                    # If we have AliasVault containers and docker-proxy is using the port,
                    # it's likely for AliasVault (especially during installation/updates)
                    is_aliasvault_port=true
                fi
            fi

            # Additional check: if we're in an AliasVault directory and docker-proxy is using the port,
            # it's very likely for AliasVault
            if [ "$is_aliasvault_port" = false ] && [ "$blocking_process" = "docker-proxy" ]; then
                # Check if we're in an AliasVault project directory
                if [ -f "docker-compose.yml" ] || [ -f ".env" ]; then
                    # If we have docker-compose.yml or .env file, this is likely an AliasVault project
                    is_aliasvault_port=true
                fi
            fi

            # Only report as an issue if it's not used by AliasVault
            if [ "$is_aliasvault_port" = false ]; then
                has_issues=true
                local port_name=""
                case "$port" in
                    "$http_port") port_name="HTTP" ;;
                    "$https_port") port_name="HTTPS" ;;
                    "$smtp_port") port_name="SMTP" ;;
                esac

                if [ -n "$blocking_process" ]; then
                    port_issues+=("Port $port ($port_name) is in use by: $blocking_process")
                else
                    port_issues+=("Port $port ($port_name) is in use by an unknown process")
                fi
            fi
        fi
    done

    if [ "$has_issues" = true ]; then
        printf "\b ${RED}✗${NC}\n"
        log_error "Port availability issues detected:"
        for issue in "${port_issues[@]}"; do
            printf "  ${RED}•${NC} %s\n" "$issue"
        done

        printf "\n${YELLOW}Common solutions:${NC}\n"

        # Show specific help based on which ports are in use
        local smtp_in_use=false
        local http_https_in_use=false

        for issue in "${port_issues[@]}"; do
            if [[ "$issue" == *"SMTP"* ]]; then
                smtp_in_use=true
            fi
            if [[ "$issue" == *"HTTP"* ]] || [[ "$issue" == *"HTTPS"* ]]; then
                http_https_in_use=true
            fi
        done

        if [ "$smtp_in_use" = true ]; then
            printf "  ${YELLOW}•${NC} Try disabling the postfix service with 'sudo systemctl stop postfix && sudo systemctl disable postfix'\n"
        fi

        if [ "$http_https_in_use" = true ]; then
            printf "  ${YELLOW}•${NC} Try stopping the existing local webserver (e.g. nginx, apache, httpd etc.)\n"
            printf "  ${YELLOW}•${NC} Change the default AliasVault ports (80, 443) by editing the .env file\n"
        fi

        printf "\nIf this still doesn't work, try finding out which services are running on the specified ports and read documentation for your distribution on how to disable them.\n"
        printf "\n"

        return 1
    fi

    printf "\b ${GREEN}✓${NC}\n"
    printf "  ${GREEN}✓ Port availability verified (HTTP:$http_port, HTTPS:$https_port, SMTP:$smtp_port)${NC}\n"
    return 0
}

# Comprehensive dependency checks
check_dependencies() {
    printf "${CYAN}ℹ Checking dependencies...${NC} "

    local missing_deps=()
    local version_issues=()
    local has_issues=false
    local spinstr='|/-\\'
    local i=0

    # Check if OS is 64-bit
    printf "\b%c" "${spinstr:$i:1}"
    ((i = (i + 1) % 4))
    local arch=$(uname -m)
    case "$arch" in
        x86_64|amd64|arm64|aarch64)
            # 64-bit architecture - continue
            ;;
        *)
            printf "\b ${RED}✗${NC}\n"
            log_error "AliasVault requires a 64-bit operating system."
            printf "\n"
            printf "${RED}${BOLD}Unsupported architecture detected: $arch${NC}\n"
            printf "\n"
            printf "AliasVault only supports 64-bit operating systems. Your current architecture ($arch) is not supported.\n"
            printf "\n"
            printf "${CYAN}Supported architectures:${NC}\n"
            printf "  ${GREEN}✓${NC} x86_64 (Intel/AMD 64-bit)\n"
            printf "  ${GREEN}✓${NC} arm64/aarch64 (ARM 64-bit)\n"
            printf "\n"
            printf "${YELLOW}Please upgrade your operating system to a 64-bit version.${NC}\n"
            printf "\n"
            return 1
            ;;
    esac

    # Check Docker
    printf "\b%c" "${spinstr:$i:1}"
    ((i = (i + 1) % 4))
    if ! command -v docker > /dev/null 2>&1; then
        missing_deps+=("docker")
        has_issues=true
    else
        local docker_version=$(docker --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
        if [ -n "$docker_version" ]; then
            if ! version_ge "$docker_version" "$MIN_DOCKER_VERSION"; then
                version_issues+=("Docker version $docker_version is below minimum required $MIN_DOCKER_VERSION")
                has_issues=true
            fi
        fi

        # Check if Docker daemon is running
        printf "\b%c" "${spinstr:$i:1}"
        ((i = (i + 1) % 4))
        if ! docker info > /dev/null 2>&1; then
            printf "\b ${RED}✗${NC}\n"
            log_error "Docker daemon cannot be reached."
            printf "\n"
            printf "${CYAN}To resolve this issue:${NC}\n"
            printf "\n"
            printf "${YELLOW}Step 1:${NC} Manually test Docker daemon status:\n"
            printf "  ${DIM}docker info${NC}\n"
            printf "\n"
            printf "${YELLOW}Step 2:${NC} If Docker is not installed or not running, follow the official installation instructions:\n"
            printf "  ${CYAN}https://docs.docker.com/engine/install/${NC}\n"
            printf "\n"
            printf "Please install the latest version of Docker and ensure the Docker daemon is running.\n"
            printf "\n"
            return 1
        fi

        # Test if Docker can actually run containers (lightweight test)
        if [ "$has_issues" != true ]; then
            printf "\b%c" "${spinstr:$i:1}"
            ((i = (i + 1) % 4))
            local docker_test_output
            docker_test_output=$(docker run --rm alpine:latest echo "test" 2>&1 >/dev/null)

            if [ $? -ne 0 ]; then
                printf "\b ${RED}✗${NC}\n"
                log_error "Docker cannot run containers properly. Error output:"
                printf "  ${RED}%s${NC}\\n\\n" "$docker_test_output"

                printf "  Possible causes:\\n"
                printf "  ${YELLOW}•${NC} Docker daemon configuration issues\\n"
                printf "  ${YELLOW}•${NC} Insufficient permissions\\n"
                printf "  ${YELLOW}•${NC} SELinux/AppArmor restrictions\\n"
                printf "  ${YELLOW}•${NC} Storage driver problems\\n"
                printf "  ${YELLOW}•${NC} Kernel compatibility issues\\n"
                printf "\\n"
                printf "  ${CYAN}To debug, try running:${NC}\\n"
                printf "  ${DIM}docker run --rm alpine:latest echo \"test\"${NC}\\n"
                printf "\\n"
                return 1
            fi
        fi
    fi

    # Check Docker Compose
    printf "\b%c" "${spinstr:$i:1}"
    ((i = (i + 1) % 4))
    if docker compose version > /dev/null 2>&1; then
        local compose_version=$(docker compose version --short 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
        if [ -n "$compose_version" ]; then
            if ! version_ge "$compose_version" "$MIN_COMPOSE_VERSION"; then
                version_issues+=("Docker Compose version $compose_version is below minimum required $MIN_COMPOSE_VERSION")
                has_issues=true
            fi
        fi
    elif command -v docker-compose > /dev/null 2>&1; then
        printf "\b ${RED}✗${NC}\n"
        local compose_version=$(docker-compose --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
        log_error "Docker Compose v1 detected ($compose_version). AliasVault requires Docker Compose v2."
        printf "\n"
        printf "${RED}${BOLD}Docker Compose v1 is not supported.${NC}\n"
        printf "\n"
        printf "${CYAN}To upgrade to Docker Compose v2:${NC}\n"
        printf "  ${YELLOW}•${NC} Uninstall docker-compose v1: sudo apt remove docker-compose (Ubuntu/Debian)\n"
        printf "  ${YELLOW}•${NC} Install Docker Compose v2 plugin: https://docs.docker.com/compose/install/linux/#install-using-the-repository\n"
        printf "\n"
        printf "${CYAN}After installation, verify with:${NC}\n"
        printf "  docker compose version\n"
        printf "\n"
        return 1
    else
        missing_deps+=("docker-compose")
        has_issues=true
    fi

    # Check essential tools
    printf "\b%c" "${spinstr:$i:1}"
    ((i = (i + 1) % 4))
    for tool in curl openssl grep sed; do
        if ! command -v "$tool" > /dev/null 2>&1; then
            missing_deps+=("$tool")
            has_issues=true
        fi
    done

    # Show final result
    if [ "$has_issues" = true ]; then
        printf "\b ${RED}✗${NC}\n"
        printf "\n"

        if [ ${#missing_deps[@]} -gt 0 ]; then
            printf "${RED}${BOLD}Missing required dependencies:${NC}\n"
            for dep in "${missing_deps[@]}"; do
                case $dep in
                    "docker")
                        printf "  ${RED}✗${NC} %s (install manual: https://docs.docker.com/engine/install/)\n" "$dep"
                        ;;
                    "docker-compose")
                        printf "  ${RED}✗${NC} %s (install manual: https://docs.docker.com/compose/install/linux/#install-using-the-repository)\n" "$dep"
                        ;;
                    *)
                        printf "  ${RED}✗${NC} %s\n" "$dep"
                        ;;
                esac
            done
            printf "\n"
        fi

        if [ ${#version_issues[@]} -gt 0 ]; then
            printf "${YELLOW}${BOLD}Version compatibility warnings:${NC}\n"
            for issue in "${version_issues[@]}"; do
                printf "  ${YELLOW}⚠${NC} %s\n" "$issue"
            done
            printf "\n"
            printf "${YELLOW}AliasVault may still work, but upgrading is recommended.${NC}\n\n"
        fi

        if [ ${#missing_deps[@]} -gt 0 ]; then
            return 1
        fi
    else
        printf "\b ${GREEN}✓${NC}\n"
    fi

    return 0
}

# Enhanced error handling with retries
retry_command() {
    local max_attempts=$1
    local delay=$2
    shift 2
    local command=("$@")
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if "${command[@]}"; then
            return 0
        fi

        if [ $attempt -lt $max_attempts ]; then
            log_warning "Attempt $attempt failed, retrying in ${delay}s..."
            sleep $delay
        fi

        ((attempt++))
    done

    log_error "Command failed after $max_attempts attempts: ${command[*]}"
    return 1
}

# Enhanced docker pull with progress
enhanced_docker_pull() {
    local image="$1"
    local image_name=$(basename "$image")

    if [ "$VERBOSE" = true ]; then
        docker pull "$image"
    else
        (
            docker pull "$image" > /tmp/docker_pull_${image_name//[:\/]/_}.log 2>&1 &
            local pull_pid=$!
            show_spinner $pull_pid "Pulling $image_name "
            wait $pull_pid
            local exit_code=$?

            if [ $exit_code -ne 0 ]; then
                cat /tmp/docker_pull_${image_name//[:\/]/_}.log >&2
            fi

            rm -f /tmp/docker_pull_${image_name//[:\/]/_}.log
            return $exit_code
        )
    fi
}

# Function to validate semver format
validate_semver() {
    local version="$1"

    # Check if version is "latest" (special case)
    if [ "$version" = "latest" ]; then
        return 0
    fi

    # Validate semver format: x.y.z where x, y, z are non-negative integers
    if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        return 0
    else
        return 1
    fi
}

# Main function
main() {
    parse_args "$@"

    # Check if command is empty (should not happen with updated parse_args)
    if [ -z "$COMMAND" ]; then
        show_usage
        exit 1
    fi

    print_logo

    # Skip dependency checks for certain commands that don't require Docker
    case $COMMAND in
        "update-installer")
            # Only check basic network connectivity for installer updates
            if ! check_connectivity; then
                exit 1
            fi
            ;;
        "install"|"build"|"update"|"configure-dev-db")
            # Full dependency check for operations that require Docker
            if ! check_dependencies; then
                exit 1
            fi

            # Run migrations
            migrate_secrets_to_files # 0.22.0+
            migrate_docker_image_urls # 0.23.0+

            # Additional checks for installation/build operations
            if [[ "$COMMAND" == "install" || "$COMMAND" == "build" || "$COMMAND" == "update" ]]; then
                if ! check_connectivity; then
                    exit 1
                fi
                if ! check_disk_space; then
                    exit 1
                fi
                if ! check_port_availability; then
                    exit 1
                fi
            fi
            ;;
    esac

    case $COMMAND in
        "build")
            handle_build
            ;;
        "install")
            handle_install "$COMMAND_ARG"
            ;;
        "uninstall")
            handle_uninstall
            ;;
        "reset-admin-password")
            generate_admin_password
            if [ $? -eq 0 ]; then
                printf "${CYAN}> Restarting admin container...${NC}\n"
                if [ "$VERBOSE" = true ]; then
                    eval "$(get_docker_compose_command) up -d --force-recreate admin"
                else
                    eval "$(get_docker_compose_command) up -d --force-recreate admin" > /dev/null 2>&1
                fi
                print_password_reset_message
            fi
            ;;
        "configure-ssl")
            handle_ssl_configuration
            ;;
        "configure-email")
            handle_email_configuration
            ;;
        "configure-registration")
            handle_registration_configuration
            ;;
        "configure-hostname")
            handle_hostname_configuration
            ;;
        "configure-ip-logging")
            handle_ip_logging_configuration
            ;;
        "start")
            handle_start
            ;;
        "stop")
            handle_stop
            ;;
        "restart")
            handle_restart
            ;;
        "update")
            handle_update
            ;;
        "update-installer")
            check_install_script_update
            exit $?
            ;;
        "configure-dev-db")
            configure_dev_database
            ;;
        "db-export")
            handle_db_export
            ;;
        "db-import")
            handle_db_import
            ;;
    esac
}

# Function to get the latest release version from GitHub (with session caching)
get_latest_version() {
    # Check if we have a cached version for this session
    if [ -n "${CACHED_LATEST_VERSION:-}" ]; then
        echo "$CACHED_LATEST_VERSION"
        return 0
    fi

    local attempt=1
    local max_attempts=5
    local wait_time=1

    while [ $attempt -le $max_attempts ]; do
        local latest_version=$(curl -Ls "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)

        if [ -n "$latest_version" ]; then
            # Cache the version for this session
            CACHED_LATEST_VERSION="$latest_version"
            echo "$latest_version"
            return 0
        fi

        printf "${YELLOW}> Attempt ${attempt}/${max_attempts}: Failed to get latest version from GitHub. Retrying in ${wait_time}s...${NC}\n" >&2
        sleep $wait_time

        # Exponential backoff - double the wait time for next attempt
        wait_time=$((wait_time * 2))
        attempt=$((attempt + 1))
    done

    printf "${RED}> Failed to get latest version from GitHub after ${max_attempts} attempts.${NC}\n" >&2
    return 1
}

# Function to initialize workspace and create required directories
initialize_workspace() {
    printf "${CYAN}ℹ Checking workspace...${NC} ${GREEN}✓${NC}\n"

    local dirs_needed=false
    for dir in "${REQUIRED_DIRS[@]}"; do
        if [ ! -d "$dir" ]; then
            if [ "$dirs_needed" = false ]; then
                printf "  ${GREEN}> Creating required directories...${NC}\n"
                dirs_needed=true
            fi
            mkdir -p "$dir"
            chmod -R 755 "$dir"
            if [ $? -ne 0 ]; then
                printf "  ${RED}> Failed to create directory: $dir${NC}\n"
                exit 1
            fi
        fi
    done
}

# Function to handle docker-compose.yml
handle_docker_compose() {
    local version_tag="$1"
    printf "${CYAN}ℹ Downloading docker-compose files for version ${version_tag}...${NC} "

    local files_to_download=(
        "docker-compose.yml"
        "docker-compose.letsencrypt.yml"
    )

    local spinstr='|/-\\'
    local i=0

    for file in "${files_to_download[@]}"; do
        printf "\b%c" "${spinstr:$i:1}"
        ((i = (i + 1) % 4))

        local temp_file="${file}.tmp"
        local download_url="${GITHUB_RAW_URL_REPO}/${version_tag}/${file}"

        # First, check if the file exists by making a HEAD request
        local http_status
        http_status=$(curl -Ls -o /dev/null -w "%{http_code}" "$download_url" 2>/dev/null)

        if [ "$http_status" = "404" ]; then
            printf "\b ${RED}✗${NC}\n"
            log_error "Version '${version_tag}' does not exist or is not available."
            log_error "The requested version may not have been released yet or may be invalid."
            printf "\n"
            printf "${CYAN}Available options:${NC}\n"
            printf "  ${YELLOW}•${NC} Check available versions at: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases\n"
            printf "  ${YELLOW}•${NC} Use a different version: ./install.sh install <version>\n"
            printf "\n"
            rm -f "$temp_file"
            exit 1
        fi

        if ! retry_command 3 2 curl -LsSf "$download_url" -o "$temp_file"; then
            printf "\b ${RED}✗${NC}\n"
            log_error "Failed to download $file from $download_url"
            log_error "Please check your internet connection and try again."
            log_info "Alternatively, download manually and place in the current directory."
            rm -f "$temp_file"
            exit 1
        fi

        # Special handling for docker-compose.yml version replacement
        if [ "$file" = "docker-compose.yml" ]; then
            if [ -n "$version_tag" ] && [ "$version_tag" != "latest" ]; then
                sed "s/:latest/:$version_tag/g" "$temp_file" > "$file"
                rm "$temp_file"
            else
                mv "$temp_file" "$file"
            fi
        else
            mv "$temp_file" "$file"
        fi
    done

    printf "\b ${GREEN}✓${NC}\n"
    return 0
}

# Function to check and update install.sh for specific version
check_install_script_version() {
    local target_version="$1"
    printf "${CYAN}ℹ Checking install script version for ${target_version}...${NC} ${GREEN}✓${NC}\n"

    # First, check if the install.sh file exists for this version
    local install_url="${GITHUB_RAW_URL_REPO}/${target_version}/install.sh"
    local http_status
    http_status=$(curl -Ls -o /dev/null -w "%{http_code}" "$install_url" 2>/dev/null)

    if [ "$http_status" = "404" ]; then
        printf "   > Install script not found for version ${target_version}. Continuing with current version.\n"
        return 1
    fi

    # Get remote install.sh for target version
    if ! curl -LsSf "$install_url" -o "install.sh.tmp"; then
        printf "${RED}> Failed to check install script version. Continuing with current version.${NC}\n"
        rm -f install.sh.tmp
        return 1
    fi

    # Get versions
    local current_version=$(extract_version "install.sh")
    local target_script_version=$(extract_version "install.sh.tmp")

    # Check if versions could be extracted
    if [ -z "$current_version" ] || [ -z "$target_script_version" ]; then
        printf "\n${YELLOW}> Could not determine script versions. Falling back to file comparison...${NC}\n"
        if ! cmp -s "install.sh" "install.sh.tmp"; then
            printf "${YELLOW}> Install script needs updating to match version ${target_version}${NC}\n"
            printf " ${GREEN}✓${NC}\n"
            return 2
        fi
    else
        if [ "$current_version" != "$target_script_version" ]; then
            printf "${YELLOW}> Install script needs updating to match version ${target_version}${NC}\n"
            printf " ${GREEN}✓${NC}\n"
            return 2
        fi
    fi

    rm -f install.sh.tmp
    return 0
}

# Function to create .env file
create_env_file() {
    printf "${CYAN}ℹ Checking .env file...${NC} ${GREEN}✓${NC}\n"
    if [ ! -f "$ENV_FILE" ]; then
        if [ ! -f "$ENV_EXAMPLE_FILE" ]; then
            # Get latest release version
            local latest_version=$(get_latest_version) || {
                printf "\n  ${YELLOW}> Failed to check latest version. Creating blank .env file.${NC}\n"
                touch "$ENV_FILE"
                return 0
            }

            printf "  ${CYAN}> Downloading .env.example...${NC}"

            # Check if .env.example exists for this version
            local env_example_url="${GITHUB_RAW_URL_REPO}/${latest_version}/.env.example"
            local http_status
            http_status=$(curl -Ls -o /dev/null -w "%{http_code}" "$env_example_url" 2>/dev/null)

            if [ "$http_status" = "404" ]; then
                printf "\n  ${YELLOW}> .env.example not found for version ${latest_version}. Creating blank .env file.${NC}\n"
                touch "$ENV_FILE"
                return 0
            fi

            if curl -LsSf "$env_example_url" -o "$ENV_EXAMPLE_FILE" > /dev/null 2>&1; then
                printf "\n  ${GREEN}> .env.example downloaded successfully.${NC}\n"
            else
                printf "\n  ${YELLOW}> Failed to download .env.example. Creating blank .env file.${NC}\n"
                touch "$ENV_FILE"
                return 0
            fi
        fi

        cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
        printf "  ${GREEN}> New .env file created from .env.example.${NC}\n"
    else
        # Check if .env file contains POSTGRES_DB or POSTGRES_USER, remove if present and show confirmation
        local removed_vars=()
        if grep -q "^POSTGRES_DB=" "$ENV_FILE"; then
            sed -i.bak "/^POSTGRES_DB=/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
            removed_vars+=("POSTGRES_DB")
        fi
        if grep -q "^POSTGRES_USER=" "$ENV_FILE"; then
            sed -i.bak "/^POSTGRES_USER=/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
            removed_vars+=("POSTGRES_USER")
        fi
        if [ ${#removed_vars[@]} -gt 0 ]; then
            printf "  ${GREEN}> Removed obsolete variable(s) from .env: %s${NC}\n" "${removed_vars[*]}"
        fi

    fi
}

populate_hostname() {
    if ! grep -q "^HOSTNAME=" "$ENV_FILE" || [ -z "$(grep "^HOSTNAME=" "$ENV_FILE" | cut -d '=' -f2)" ]; then
        while true; do
            read -p "Enter the hostname where this AliasVault server can be accessed (e.g. aliasvault.example.com): " USER_HOSTNAME
            if [ -n "$USER_HOSTNAME" ]; then
                HOSTNAME="$USER_HOSTNAME"
                break
            else
                printf "${YELLOW}> Hostname cannot be empty. Please enter a valid hostname.${NC}\n"
            fi
        done
        update_env_var "HOSTNAME" "$HOSTNAME"
    else
        HOSTNAME=$(grep "^HOSTNAME=" "$ENV_FILE" | cut -d '=' -f2)
    fi
}

# Function to generate admin password
generate_admin_password() {
    printf "${CYAN}ℹ Generating admin password...${NC} ${GREEN}✓${NC}\n"
    PASSWORD=$(openssl rand -base64 12)

    # Build locally if in build mode or if pre-built image is not available
    if grep -q "^DEPLOYMENT_MODE=build" "$ENV_FILE" 2>/dev/null || ! docker pull ${GITHUB_CONTAINER_REGISTRY}/installcli:latest > /dev/null 2>&1; then
        log_info "Building InstallCli locally..."
        if [ "$VERBOSE" = true ]; then
            if ! docker build -t installcli -f apps/server/Utilities/AliasVault.InstallCli/Dockerfile .; then
                log_error "Failed to build InstallCli Docker image"
                exit 1
            fi
        else
            (
                docker build -t installcli -f apps/server/Utilities/AliasVault.InstallCli/Dockerfile . > install_build_output.log 2>&1 &
                BUILD_PID=$!
                show_spinner $BUILD_PID "Building InstallCli image "
                wait $BUILD_PID
                BUILD_EXIT_CODE=$?

                if [ $BUILD_EXIT_CODE -ne 0 ]; then
                    log_error "Failed to build InstallCli Docker image. Build output:"
                    cat install_build_output.log >&2
                    exit $BUILD_EXIT_CODE
                fi

                rm -f install_build_output.log
            )
        fi
        HASH=$(docker run --rm installcli hash-password "$PASSWORD")
    else
        HASH=$(docker run --rm ${GITHUB_CONTAINER_REGISTRY}/installcli:latest hash-password "$PASSWORD")
    fi

    if [ -z "$HASH" ]; then
        printf "\n${RED}> Error: Failed to generate password hash${NC}\n"
        exit 1
    fi

    # Write admin password hash to secret file with timestamp
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    write_secret_to_file "admin_password_hash" "${HASH}|${TIMESTAMP}"
}

# Helper function to update environment variables
update_env_var() {
    local key=$1
    local value=$2

    if [ -f "$ENV_FILE" ]; then
        # Check if key exists
        if grep -q "^${key}=" "$ENV_FILE"; then
            # Update existing key inline
            sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        else
            # Key doesn't exist, append it
            echo "$key=$value" >> "$ENV_FILE"
        fi
    else
        # File doesn't exist, create it with the key-value pair
        echo "$key=$value" > "$ENV_FILE"
    fi

    printf "  ${GREEN}> $key has been set in $ENV_FILE.${NC}\n"
}

# Helper function to write secrets to files instead of .env
write_secret_to_file() {
    local secret_name=$1
    local secret_value=$2
    local secret_file="${SECRETS_DIR}/${secret_name}"

    # Create secrets directory if it doesn't exist
    if [ ! -d "$SECRETS_DIR" ]; then
        mkdir -p "$SECRETS_DIR"
        chmod 700 "$SECRETS_DIR"
    fi

    # Write secret to file
    echo -n "$secret_value" > "$secret_file"
    chmod 600 "$secret_file"

    printf "  ${GREEN}> Secret $secret_name has been written to $secret_file${NC}\n"
}

# Helper function to read secret from file
read_secret_from_file() {
    local secret_name=$1
    local secret_file="${SECRETS_DIR}/${secret_name}"

    if [ -f "$secret_file" ]; then
        cat "$secret_file"
    else
        echo ""
    fi
}

# Function to migrate secrets from .env to files
# Used when migrating from 0.21.0 or lower to 0.22.0+
migrate_secrets_to_files() {
    # Check if migration is needed
    if [ ! -f "$ENV_FILE" ]; then
        return 0
    fi

    # Check if any secrets exist in .env file
    if ! grep -q "^JWT_KEY=\|^DATA_PROTECTION_CERT_PASS=\|^POSTGRES_PASSWORD=\|^ADMIN_PASSWORD_HASH=" "$ENV_FILE" 2>/dev/null; then
        return 0
    fi

    printf "${CYAN}ℹ Migrating secrets from .env to secret files...${NC}\n"

    local migrated=false
    local confirm_overwrite=false

    # Migrate PRIVATE_EMAIL_DOMAINS from DISABLED.TLD to empty string (v0.22.0+)
    if grep -q "^PRIVATE_EMAIL_DOMAINS=DISABLED.TLD" "$ENV_FILE"; then
        update_env_var "PRIVATE_EMAIL_DOMAINS" ""
        printf "  Migrated PRIVATE_EMAIL_DOMAINS (DISABLED.TLD → empty string, v0.22.0+)\n"
    fi

    # Check if any secret files already exist
    if [ -f "${SECRETS_DIR}/jwt_key" ] || [ -f "${SECRETS_DIR}/data_protection_cert_pass" ] ||
       [ -f "${SECRETS_DIR}/postgres_password" ] || [ -f "${SECRETS_DIR}/admin_password_hash" ]; then
        printf "${YELLOW}⚠ Some secret files already exist. Do you want to overwrite them with values from .env? (y/n):${NC} "
        read -r response
        if [ "$response" != "y" ] && [ "$response" != "Y" ]; then
            printf "${CYAN}ℹ Skipping secret migration (keeping existing secret files)${NC}\n"
            # Still remove secrets from .env if they exist there
            remove_secrets_from_env
            return 0
        fi
        confirm_overwrite=true
    fi

    # Create secrets directory if it doesn't exist
    if [ ! -d "$SECRETS_DIR" ]; then
        mkdir -p "$SECRETS_DIR"
        chmod 700 "$SECRETS_DIR"
    fi

    # Migrate JWT_KEY
    if grep -q "^JWT_KEY=" "$ENV_FILE" 2>/dev/null; then
        JWT_KEY=$(grep "^JWT_KEY=" "$ENV_FILE" | cut -d '=' -f2-)
        if [ -n "$JWT_KEY" ]; then
            write_secret_to_file "jwt_key" "$JWT_KEY"
            migrated=true
        fi
    fi

    # Migrate DATA_PROTECTION_CERT_PASS
    if grep -q "^DATA_PROTECTION_CERT_PASS=" "$ENV_FILE" 2>/dev/null; then
        CERT_PASS=$(grep "^DATA_PROTECTION_CERT_PASS=" "$ENV_FILE" | cut -d '=' -f2-)
        if [ -n "$CERT_PASS" ]; then
            write_secret_to_file "data_protection_cert_pass" "$CERT_PASS"
            migrated=true
        fi
    fi

    # Migrate POSTGRES_PASSWORD
    if grep -q "^POSTGRES_PASSWORD=" "$ENV_FILE" 2>/dev/null; then
        POSTGRES_PASS=$(grep "^POSTGRES_PASSWORD=" "$ENV_FILE" | cut -d '=' -f2-)
        if [ -n "$POSTGRES_PASS" ]; then
            write_secret_to_file "postgres_password" "$POSTGRES_PASS"
            migrated=true
        fi
    fi

    # Migrate ADMIN_PASSWORD_HASH (with timestamp)
    if grep -q "^ADMIN_PASSWORD_HASH=" "$ENV_FILE" 2>/dev/null; then
        ADMIN_HASH=$(grep "^ADMIN_PASSWORD_HASH=" "$ENV_FILE" | cut -d '=' -f2-)
        if [ -n "$ADMIN_HASH" ]; then
            # Get the timestamp if it exists
            TIMESTAMP=""
            if grep -q "^ADMIN_PASSWORD_GENERATED=" "$ENV_FILE" 2>/dev/null; then
                TIMESTAMP=$(grep "^ADMIN_PASSWORD_GENERATED=" "$ENV_FILE" | cut -d '=' -f2-)
            else
                TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
            fi
            # Write hash with timestamp appended
            write_secret_to_file "admin_password_hash" "${ADMIN_HASH}|${TIMESTAMP}"
            migrated=true
        fi
    fi

    if [ "$migrated" = true ]; then
        printf "  ${GREEN}✓ Secrets have been migrated from .env to secret files${NC}\n"
        # Remove secrets from .env after successful migration
        remove_secrets_from_env
    elif [ "$confirm_overwrite" = false ]; then
        printf "  ${CYAN}ℹ No secrets found in .env to migrate${NC}\n"
    fi
}

# Function to remove secrets from .env file. This is used to migrate pre-0.22.0 .env files to the new secret file format.
# Can be removed later when v1.0 is launched.
remove_secrets_from_env() {
    local removed=false

    # Only proceed if .env file exists
    if [ ! -f "$ENV_FILE" ]; then
        return 0
    fi

    # Verify that secret files exist before removing from .env
    local all_secrets_migrated=true

    if grep -q "^JWT_KEY=" "$ENV_FILE" 2>/dev/null && [ ! -f "${SECRETS_DIR}/jwt_key" ]; then
        all_secrets_migrated=false
    fi

    if grep -q "^DATA_PROTECTION_CERT_PASS=" "$ENV_FILE" 2>/dev/null && [ ! -f "${SECRETS_DIR}/data_protection_cert_pass" ]; then
        all_secrets_migrated=false
    fi

    if grep -q "^POSTGRES_PASSWORD=" "$ENV_FILE" 2>/dev/null && [ ! -f "${SECRETS_DIR}/postgres_password" ]; then
        all_secrets_migrated=false
    fi

    if grep -q "^ADMIN_PASSWORD_HASH=" "$ENV_FILE" 2>/dev/null && [ ! -f "${SECRETS_DIR}/admin_password_hash" ]; then
        all_secrets_migrated=false
    fi

    if [ "$all_secrets_migrated" = false ]; then
        printf "${YELLOW}⚠ Not all secrets have been migrated to files. Keeping secrets in .env${NC}\n"
        return 1
    fi

    # Remove secrets from .env
    if grep -q "^JWT_KEY=" "$ENV_FILE"; then
        sed -i.bak "/^JWT_KEY=/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        removed=true
    fi

    if grep -q "^DATA_PROTECTION_CERT_PASS=" "$ENV_FILE"; then
        sed -i.bak "/^DATA_PROTECTION_CERT_PASS=/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        removed=true
    fi

    if grep -q "^POSTGRES_PASSWORD=" "$ENV_FILE"; then
        sed -i.bak "/^POSTGRES_PASSWORD=/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        removed=true
    fi

    if grep -q "^ADMIN_PASSWORD_HASH=" "$ENV_FILE"; then
        sed -i.bak "/^ADMIN_PASSWORD_HASH=/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        removed=true
    fi

    if grep -q "^ADMIN_PASSWORD_GENERATED=" "$ENV_FILE"; then
        sed -i.bak "/^ADMIN_PASSWORD_GENERATED=/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        removed=true
    fi

    if [ "$removed" = true ]; then
        printf "  ${GREEN}✓ Secrets have been removed from .env file${NC}\n"
    fi
}


# Helper function to delete environment variables
delete_env_var() {
    local key=$1

    if [ -f "$ENV_FILE" ]; then
        sed -i.bak "/^${key}=/d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
        printf "  ${GREEN}> $key has been removed from $ENV_FILE.${NC}\n"
    fi
}

# Function to migrate Docker image URLs from old namespace to new namespace
# Used when migrating from 0.22.0 or lower to 0.23.0+
migrate_docker_image_urls() {
    if [ ! -f "docker-compose.yml" ] || ! grep -q "ghcr.io/lanedirt/aliasvault-" "docker-compose.yml" 2>/dev/null; then
        return 0
    fi

    printf "${CYAN}ℹ Migrating Docker image URLs to new official namespace aliasvault/*...${NC}\n"

    # Process docker-compose.yml
    if [ -f "docker-compose.yml" ] && grep -q "ghcr.io/lanedirt/aliasvault-" "docker-compose.yml"; then
        # Create backup before modifying
        cp docker-compose.yml "docker-compose.yml.backup.$(date +%Y%m%d_%H%M%S)"

        # Update all image URLs
        sed -i.tmp 's|ghcr.io/lanedirt/aliasvault-postgres:|ghcr.io/aliasvault/postgres:|g' docker-compose.yml
        sed -i.tmp 's|ghcr.io/lanedirt/aliasvault-client:|ghcr.io/aliasvault/client:|g' docker-compose.yml
        sed -i.tmp 's|ghcr.io/lanedirt/aliasvault-api:|ghcr.io/aliasvault/api:|g' docker-compose.yml
        sed -i.tmp 's|ghcr.io/lanedirt/aliasvault-admin:|ghcr.io/aliasvault/admin:|g' docker-compose.yml
        sed -i.tmp 's|ghcr.io/lanedirt/aliasvault-smtp:|ghcr.io/aliasvault/smtp:|g' docker-compose.yml
        sed -i.tmp 's|ghcr.io/lanedirt/aliasvault-task-runner:|ghcr.io/aliasvault/task-runner:|g' docker-compose.yml
        sed -i.tmp 's|ghcr.io/lanedirt/aliasvault-reverse-proxy:|ghcr.io/aliasvault/reverse-proxy:|g' docker-compose.yml

        # Clean up temp file
        rm -f docker-compose.yml.backup.*

        printf "  ${GREEN}✓ Updated docker-compose.yml${NC}\n"
    fi

    printf "  ${GREEN}✓ Docker image URL migration completed${NC}\n"
}

# Function to print a success box
print_success_box() {
    local message="$1"
    local width=70
    local header="╔══════════════════════════════════════════════════════════════════════╗"
    local footer="╚══════════════════════════════════════════════════════════════════════╝"
    local success="✓ SUCCESS!"
    local success_line
    local message_line
    local padding

    # Print header
    printf "${MAGENTA}%s${NC}\n" "$header"

    # Construct second line with centered success text
    local success_padding=$(( (width - ${#success}) / 2 ))
    printf "${MAGENTA}║${NC}%*s${GREEN}%s${NC}%*s${MAGENTA}║${NC}\n" \
        "$success_padding" "" "$success" "$((width - success_padding - ${#success}))" ""

    # Construct third line with centered message
    local msg_len=${#message}
    local msg_padding=$(( (width  - msg_len) / 2 ))
    printf "${MAGENTA}║${NC}%*s${BOLD}%s${NC}%*s${MAGENTA}║${NC}\n" \
        "$msg_padding" "" "$message" "$((width - msg_padding - msg_len))" ""

    # Print footer
    printf "${MAGENTA}%s${NC}\n" "$footer"
}

# Function to clean up old Docker images
cleanup_docker_images() {
    printf "\n${YELLOW}+++ Cleaning up old Docker images +++${NC}\n"

    # Only clean up AliasVault-related images and dangling images
    local current_version="$1"
    local removed_count=0
    local total_count=0

    if [ "$VERBOSE" = true ]; then
        printf "${CYAN}ℹ Removing old AliasVault images...${NC}\n"

        # Remove dangling images (untagged)
        docker image prune -f

        # Get all images containing "aliasvault" (case-insensitive) in the repository name
        docker images --format "{{.Repository}}:{{.Tag}}" | grep -i "aliasvault" | \
        while read -r image_full; do
            # Extract just the tag from the full image name
            local tag="${image_full##*:}"

            # Skip if image is currently being used by a container
            if ! docker ps -a --format "{{.Image}}" | grep -q "^${image_full}$"; then
                # Skip if it's the current version or latest
                if [ "$tag" != "$current_version" ] && [ "$tag" != "latest" ]; then
                    ((total_count++))
                    printf "  Removing old image: $image_full"
                    # Remove by full repository:tag name, not by ID
                    if docker rmi "$image_full" > /dev/null 2>&1; then
                        printf " ${GREEN}✓${NC}\n"
                        ((removed_count++))
                    else
                        printf " ${YELLOW}(skipped - may share layers)${NC}\n"
                    fi
                fi
            fi
        done

        if [ $total_count -eq 0 ]; then
            printf "  ${CYAN}No old images to remove${NC}\n"
        elif [ $removed_count -eq $total_count ]; then
            printf "  ${GREEN}Successfully removed all $removed_count old image(s)${NC}\n"
        else
            printf "  ${GREEN}Removed $removed_count of $total_count old image(s)${NC}\n"
        fi

        printf "${GREEN}✓ Docker image cleanup completed${NC}\n"
    else
        (
            # Silent cleanup with spinner
            {
                # Remove dangling images
                docker image prune -f > /dev/null 2>&1

                # Remove old AliasVault images by full name
                docker images --format "{{.Repository}}:{{.Tag}}" | grep -i "aliasvault" | \
                while read -r image_full; do
                    # Extract just the tag from the full image name
                    local tag="${image_full##*:}"

                    # Skip if image is currently being used by a container
                    if ! docker ps -a --format "{{.Image}}" | grep -q "^${image_full}$"; then
                        # Skip if it's the current version or latest
                        if [ "$tag" != "$current_version" ] && [ "$tag" != "latest" ]; then
                            # Remove by full repository:tag name
                            docker rmi "$image_full" > /dev/null 2>&1 || true
                        fi
                    fi
                done
            } &
            CLEANUP_PID=$!
            show_spinner $CLEANUP_PID "Cleaning up old Docker images "
            wait $CLEANUP_PID
        )
        printf "${GREEN}✓ Docker image cleanup completed${NC}\n"
    fi
}

# Function to print success message
print_install_success_message() {
    printf "\n"
    print_success_box "AliasVault is successfully installed!"
    printf "\n"
    printf "${BOLD}To configure the server, login to the admin panel:${NC}\n"
    printf "\n"
    if [ -n "$PASSWORD" ]; then
        printf "  ${CYAN}Admin Panel:${NC} https://localhost/admin\n"
        printf "  ${CYAN}Username:${NC} admin\n"
        printf "  ${CYAN}Password:${NC} $PASSWORD\n"
        printf "\n"
        printf "${YELLOW}⚠  IMPORTANT: Make sure to backup the above credentials in a safe place,${NC}\n"
        printf "${YELLOW}   they won't be shown again!${NC}\n"
    else
        printf "  ${CYAN}Admin Panel:${NC} https://localhost/admin\n"
        printf "  ${CYAN}Username:${NC} admin\n"
        printf "  ${CYAN}Password:${NC} (Previously set. Use ./install.sh reset-admin-password to generate new one.)\n"
    fi
    printf "\n"
    printf "${BOLD}To start using AliasVault, log into the client website:${NC}\n"
    printf "\n"
    printf "  ${CYAN}Client Website:${NC} https://localhost/\n"
}

# Function to check if AliasVault is responding on configured ports
check_aliasvault_health() {
    printf "${CYAN}ℹ Verifying AliasVault is responding...${NC} "

    local ports_config
    ports_config=$(get_port_config)
    read -r http_port https_port smtp_port <<< "$ports_config"

    local max_attempts=30
    local attempt=1
    local spinstr='|/-\\'
    local i=0
    local all_healthy=false

    while [ $attempt -le $max_attempts ]; do
        printf "\b%c" "${spinstr:$i:1}"
        ((i = (i + 1) % 4))

        local http_ok=false
        local https_ok=false

        # Check HTTP port (should redirect to HTTPS)
        if curl -Ls -o /dev/null -w "%{http_code}" "http://localhost:$http_port" 2>/dev/null | grep -q "301"; then
            http_ok=true
        fi

        # Check HTTPS port (should return status page or main app)
        local https_status
        https_status=$(curl -Ls -k -o /dev/null -w "%{http_code}" "https://localhost:$https_port" 2>/dev/null)
        if [ "$https_status" = "200" ] || [ "$https_status" = "503" ]; then
            https_ok=true
        fi

        if [ "$http_ok" = true ] && [ "$https_ok" = true ]; then
            all_healthy=true
            break
        fi

        sleep 2
        ((attempt++))
    done

    if [ "$all_healthy" = true ]; then
        printf "\b ${GREEN}✓${NC}\n"
        printf "  ${GREEN}✓ AliasVault is responding on HTTP:$http_port and HTTPS:$https_port${NC}\n"
        return 0
    else
        printf "\b ${RED}✗${NC}\n"
        printf "\n${RED}❌ Health Check Failed${NC}\n"
        printf "AliasVault containers started but the service is not responding properly.\n"
        printf "\n"
        printf "${YELLOW}Troubleshooting steps:${NC}\n"
        printf "1. Check container status: ${DIM}docker compose ps${NC}\n"
        printf "2. Check container logs: ${DIM}docker compose logs${NC}\n"
        printf "3. Verify ports are not blocked by firewall\n"
        printf "4. Wait a few more minutes for services to fully initialize\n"
        printf "\n"
        printf "You can manually check if AliasVault is working by visiting:\n"
        printf "  ${CYAN}https://localhost:$https_port${NC}\n"
        printf "\n"
        return 1
    fi
}

# Function to recreate (restart) Docker containers
recreate_docker_containers() {

    if [ "$VERBOSE" = true ]; then
        printf "${CYAN}ℹ (Re)creating Docker containers...${NC}\n"
        printf "\b${NC}\n"
        if ! eval "$(get_docker_compose_command) up -d --force-recreate"; then
            log_error "Failed to recreate Docker containers"
            exit 1
        fi
    else
        (
            eval "$(get_docker_compose_command) up -d --force-recreate" > /tmp/docker_recreate.log 2>&1 &
            RECREATE_PID=$!
            show_spinner $RECREATE_PID "Recreating Docker containers "
            wait $RECREATE_PID
            RECREATE_EXIT_CODE=$?

            if [ $RECREATE_EXIT_CODE -ne 0 ]; then
                log_error "Failed to recreate Docker containers. Output:"
                cat /tmp/docker_recreate.log >&2
                exit 1
            fi

            rm -f /tmp/docker_recreate.log
        )
    fi
    printf "${GREEN}✓ Docker containers (re)created successfully${NC}\n"
}

# Function to print password reset success message
print_password_reset_message() {
    printf "\n"
    print_success_box "The admin password has been successfully reset!"
    printf "\n"
    printf "${BOLD}New admin credentials:${NC}\n"
    printf "  ${CYAN}Admin Panel:${NC} https://localhost/admin\n"
    printf "  ${CYAN}Username:${NC} admin\n"
    printf "  ${CYAN}Password:${NC} $PASSWORD\n"
    printf "\n"
    printf "${YELLOW}⚠  IMPORTANT: Make sure to backup the above credentials in a safe place,${NC}\n"
    printf "${YELLOW}   they won't be shown again!${NC}\n"
}

# Function to get docker compose command with appropriate config files
get_docker_compose_command() {
    local base_command="docker compose -f docker-compose.yml"

    # Check if using build configuration
    if grep -q "^DEPLOYMENT_MODE=build" "$ENV_FILE" 2>/dev/null; then
        base_command="$base_command -f dockerfiles/docker-compose.build.yml"
    fi

    # Check if Let's Encrypt is enabled
    if grep -q "^LETSENCRYPT_ENABLED=true" "$ENV_FILE" 2>/dev/null; then
        base_command="$base_command -f docker-compose.letsencrypt.yml"
    fi

    echo "$base_command"
}

# Add this new function for handling registration configuration
handle_registration_configuration() {
    printf "${YELLOW}+++ Public Registration Configuration +++${NC}\n"
    printf "\n"

    # Check if AliasVault is installed
    if [ ! -f "docker-compose.yml" ]; then
        printf "${RED}Error: AliasVault must be installed first.${NC}\n"
        exit 1
    fi

    # Get current registration setting
    CURRENT_SETTING=$(grep "^PUBLIC_REGISTRATION_ENABLED=" "$ENV_FILE" | cut -d '=' -f2)

    printf "${CYAN}About Public Registration:${NC}\n"
    printf "Public registration allows new users to create their own accounts on your AliasVault server.\n"
    printf "When disabled, no new accounts can be created.\n"
    printf "\n"
    printf "${CYAN}Current Configuration:${NC}\n"
    if [ "$CURRENT_SETTING" = "true" ]; then
        printf "Public Registration: ${GREEN}Enabled${NC}\n"
    else
        printf "Public Registration: ${RED}Disabled${NC}\n"
    fi

    printf "\n"
    printf "Options:\n"
    printf "1) Enable public registration\n"
    printf "2) Disable public registration\n"
    printf "3) Cancel\n"
    printf "\n"

    read -p "Select an option [1-3]: " reg_option

    case $reg_option in
        1)
            update_env_var "PUBLIC_REGISTRATION_ENABLED" "true"

            printf "\n${YELLOW}Warning: Docker containers need to be restarted to apply these changes.${NC}\n"
            read -p "Restart now? (y/n): " restart_confirm

            if [ "$restart_confirm" != "y" ] && [ "$restart_confirm" != "Y" ]; then
                printf "${YELLOW}Please restart manually to apply the changes.${NC}\n"
                exit 0
            fi

            handle_restart

            # Print success message
            printf "\n"
            print_success_box "Public registration has been enabled!"
            ;;
        2)
            update_env_var "PUBLIC_REGISTRATION_ENABLED" "false"

            printf "\n${YELLOW}Warning: Docker containers need to be restarted to apply these changes.${NC}\n"
            read -p "Restart now? (y/n): " restart_confirm

            if [ "$restart_confirm" != "y" ] && [ "$restart_confirm" != "Y" ]; then
                printf "${YELLOW}Please restart manually to apply the changes.${NC}\n"
                exit 0
            fi

            handle_restart

            # Print success message
            printf "\n"
            print_success_box "Public registration has been disabled!"
            ;;
        3)
            printf "${YELLOW}Registration configuration cancelled.${NC}\n"
            exit 0
            ;;
        *)
            printf "${RED}Invalid option selected.${NC}\n"
            exit 1
            ;;
    esac
}

# Function to handle initial installation or reinstallation
handle_install() {
    local specified_version="$1"

    # If version specified, install that version directly
    if [ -n "$specified_version" ]; then
        handle_install_version "$specified_version"
        return
    fi

    # Check if .env exists before reading
    if [ -f "$ENV_FILE" ]; then
        if grep -q "^ALIASVAULT_VERSION=" "$ENV_FILE"; then
            current_version=$(grep "^ALIASVAULT_VERSION=" "$ENV_FILE" | cut -d '=' -f2)
            printf "${CYAN}> Current AliasVault version: ${current_version}${NC}\n"
            printf "\n"
            printf "==================================================\n"
            printf "AliasVault is already installed.\n"
            printf "==================================================\n"
            printf "1. To reinstall the current version (${current_version}), continue with this script\n"
            printf "2. To check for updates and to install the latest version, use: ./install.sh update\n"
            printf "3. To install a specific version, use: ./install.sh install <version>\n\n"

            read -p "Would you like to reinstall the current version? [y/N]: " REPLY
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                printf "${YELLOW}> Installation cancelled.${NC}\n"
                exit 0
            fi

            handle_install_version "$current_version"
            return
        fi
    fi

    handle_install_version "latest"
}

# Function to handle build
handle_build() {
    printf "\n${YELLOW}+++ Building AliasVault from source +++${NC}\n"

    # Set deployment mode to build to ensure container lifecycle uses build configuration
    set_deployment_mode "build"

    # Initialize workspace which makes sure all required directories and files exist
    initialize_workspace

    # Check for required build files
    if [ ! -f "dockerfiles/docker-compose.build.yml" ] || [ ! -d "apps/server" ]; then
        printf "${RED}Error: Required files for building from source are missing.${NC}\n"
        printf "\n"
        printf "To build AliasVault from source, you need:\n"
        printf "1. dockerfiles/docker-compose.build.yml file\n"
        printf "2. apps/server/ directory with the complete source code\n"
        printf "\n"
        printf "Please clone the complete repository using:\n"
        printf "git clone https://github.com/${REPO_OWNER}/${REPO_NAME}.git\n"
        printf "\n"
        printf "Alternatively, you can use './install.sh install' to pull pre-built images.\n"
        exit 1
    fi

    # Initialize environment with proper error handling
    check_and_populate_env

    # Only generate admin password if not already set
    if [ ! -f "${SECRETS_DIR}/admin_password_hash" ] || [ -z "$(cat "${SECRETS_DIR}/admin_password_hash" 2>/dev/null)" ]; then
        generate_admin_password || { printf "${RED}> Failed to generate admin password${NC}\n"; exit 1; }
    fi

    printf "\n${YELLOW}+++ Building and starting services +++${NC}\n"

    if [ "$VERBOSE" = true ]; then
        printf "${CYAN}ℹ Building Docker Compose stack...${NC}\n"
        printf "\b${NC}\n"
        if ! eval "$(get_docker_compose_command) build"; then
            log_error "Failed to build Docker Compose stack"
            exit 1
        fi
    else
        (
            eval "$(get_docker_compose_command) build" > install_compose_build_output.log 2>&1 &
            BUILD_PID=$!
            show_spinner $BUILD_PID "Building Docker Compose stack "
            wait $BUILD_PID
            BUILD_EXIT_CODE=$?

            if [ $BUILD_EXIT_CODE -ne 0 ]; then
                log_error "Failed to build Docker Compose stack. Build output:"
                cat install_compose_build_output.log >&2
                exit 1
            fi

            rm -f install_compose_build_output.log
        )
    fi
    printf "${GREEN}✓ Docker Compose stack built successfully${NC}\n"

    recreate_docker_containers

    # Check if AliasVault is actually responding before showing success
    if ! check_aliasvault_health; then
        printf "${YELLOW}Installation completed but AliasVault health check failed.${NC}\n"
        printf "${YELLOW}Please check the troubleshooting steps above.${NC}\n"
        exit 1
    fi

    # Clean up old Docker images
    cleanup_docker_images "$target_version"

    # Only show success message if we made it here without errors and health check passed
    print_install_success_message
}

# Function to handle uninstall
handle_uninstall() {
    printf "${YELLOW}+++ Uninstalling AliasVault +++${NC}\n"
    printf "\n"

    # Check if -y flag was passed
    if [ "$FORCE_YES" != "true" ]; then
        # Ask for confirmation before proceeding
        read -p "Are you sure you want to uninstall AliasVault? This will remove all containers and images. [y/N]: " REPLY
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            printf "${YELLOW}> Uninstall cancelled.${NC}\n"
            exit 0
        fi
    fi

    printf "${CYAN}> Stopping and removing Docker containers...${NC}\n"
    if [ "$VERBOSE" = true ]; then
        docker compose -f docker-compose.yml down -v || {
            printf "${RED}> Failed to stop and remove Docker containers${NC}\n"
            exit 1
        }
    else
        docker compose -f docker-compose.yml down -v > /dev/null 2>&1 || {
            printf "${RED}> Failed to stop and remove Docker containers${NC}\n"
            exit 1
        }
    fi
    printf "${GREEN}> Docker containers stopped and removed.${NC}\n"

    # Remove version from .env
    delete_env_var "ALIASVAULT_VERSION" ""

    printf "${CYAN}> Removing Docker images...${NC}\n"
    if [ "$VERBOSE" = true ]; then
        docker compose -f docker-compose.yml down --rmi all || {
            printf "${RED}> Failed to remove Docker images${NC}\n"
            exit 1
        }
    else
        docker compose -f docker-compose.yml down --rmi all > /dev/null 2>&1 || {
            printf "${RED}> Failed to remove Docker images${NC}\n"
            exit 1
        }
    fi
    printf "${GREEN}> Docker images removed.${NC}\n"

    printf "${CYAN}> Pruning Docker system...${NC}\n"
    if [ "$VERBOSE" = true ]; then
        docker system prune -af || {
            printf "${RED}> Failed to prune Docker system${NC}\n"
            exit 1
        }
    else
        docker system prune -af > /dev/null 2>&1 || {
            printf "${RED}> Failed to prune Docker system${NC}\n"
            exit 1
        }
    fi
    printf "${GREEN}> Docker system pruned.${NC}\n"

    # Only show success message if we made it here without errors
    printf "\n"
    print_success_box "AliasVault has been successfully uninstalled!"
    printf "\n"
    printf "All Docker containers and images related to AliasVault have been removed.\n"
    printf "The current directory, including database, logs and .env files, has been left intact.\n"
    printf "\n"
    printf "If you wish to remove the remaining files, it's safe to do so now.\n"
}

# Function to handle SSL configuration
handle_ssl_configuration() {
    printf "${YELLOW}+++ SSL Certificate Configuration +++${NC}\n"
    printf "\n"

    # Check if AliasVault is installed
    if [ ! -f "docker-compose.yml" ]; then
        printf "${RED}Error: AliasVault must be installed first.${NC}\n"
        exit 1
    fi

    populate_hostname || { printf "${RED}> Failed to set hostname${NC}\n"; exit 1; }

    # Get the current hostname and SSL config from .env
    CURRENT_HOSTNAME=$(grep "^HOSTNAME=" "$ENV_FILE" | cut -d '=' -f2)
    LETSENCRYPT_ENABLED=$(grep "^LETSENCRYPT_ENABLED=" "$ENV_FILE" | cut -d '=' -f2)

    printf "${CYAN}SSL Certificate Options:${NC}\n"
    printf "AliasVault uses a self-signed SSL certificate by default.\n"
    printf "This provides encryption but may trigger browser warnings.\n"
    printf "\n"
    printf "You can switch to a trusted Let's Encrypt certificate, which:\n"
    printf "  - Avoids browser warnings\n"
    printf "  - Requires a public domain (not localhost)\n"
    printf "  - Needs ports 80 and 443 open to the internet\n"
    printf "\n"
    printf "Let's Encrypt certificates auto-renew before expiry.\n"
    printf "\n"
    printf "${CYAN}Current Configuration:${NC}\n"
    if [ "$LETSENCRYPT_ENABLED" = "true" ]; then
        printf "Using: ${GREEN}Let's Encrypt${NC}\n"
    else
        printf "Using: ${YELLOW}Self-signed${NC}\n"
    fi
    printf "Hostname: ${CYAN}${CURRENT_HOSTNAME}${NC} (change via: ./install.sh configure-hostname)\n"
    printf "\n"
    printf "Choose an option:\n"
    printf "1) Use Let's Encrypt certificate (recommended for public domains)\n"
    printf "2) Use self-signed certificate\n"
    printf "3) Cancel\n"
    printf "\n"

    read -p "Select an option [1-3]: " ssl_option

    case $ssl_option in
        1)
            configure_letsencrypt
            ;;
        2)
            generate_self_signed_cert
            ;;
        3)
            printf "${YELLOW}SSL configuration cancelled.${NC}\n"
            exit 0
            ;;
        *)
            printf "${RED}Invalid option selected.${NC}\n"
            exit 1
            ;;
    esac
}

# Function to handle email server configuration
handle_email_configuration() {
    # Setup trap for Ctrl+C and other interrupts
    trap 'printf "\n${YELLOW}Configuration cancelled by user.${NC}\n"; exit 1' INT TERM

    printf "${YELLOW}+++ Email Server Configuration +++${NC}\n"
    printf "\n"

    # Check if AliasVault is installed
    if [ ! -f "docker-compose.yml" ]; then
        printf "${RED}Error: AliasVault must be installed first.${NC}\n"
        exit 1
    fi

    # Get current email domains from .env
    CURRENT_DOMAINS=$(grep "^PRIVATE_EMAIL_DOMAINS=" "$ENV_FILE" | cut -d '=' -f2)

    printf "${CYAN}About Email Server:${NC}\n"
    printf "AliasVault includes a built-in email server for handling virtual email addresses.\n"
    printf "When enabled, it can receive emails for one or more configured domains.\n"
    printf "Each domain must have an MX DNS record pointing to this server's hostname.\n"
    printf "\n"
    printf "${CYAN}Current Configuration:${NC}\n"

    if [ -z "$CURRENT_DOMAINS" ] || [ "$CURRENT_DOMAINS" = "DISABLED.TLD" ]; then
        printf "Email Server Status: ${RED}Disabled${NC}\n"
    else
        printf "Email Server Status: ${GREEN}Enabled${NC}\n"
        printf "Active Domains: ${CYAN}${CURRENT_DOMAINS}${NC}\n"
    fi

    printf "\n"
    printf "Email Server Options:\n"
    printf "1) Enable email server / Update domains\n"
    printf "2) Disable email server\n"
    printf "3) Cancel\n"
    printf "\n"

    read -p "Select an option [1-3]: " email_option

    case $email_option in
        1)
            while true; do
                printf "\n${CYAN}Enter domain(s) for email server${NC}\n"
                printf "For multiple domains, separate with commas (e.g. domain1.com,domain2.com)\n"
                printf "IMPORTANT: Each domain must have an MX record in DNS pointing to this server.\n"
                read -p "Domains: " new_domains

                if [ -z "$new_domains" ]; then
                    printf "${RED}Error: Domains cannot be empty${NC}\n"
                    continue
                fi

                printf "\n${CYAN}You entered the following domains:${NC}\n"
                IFS=',' read -ra DOMAIN_ARRAY <<< "$new_domains"
                for domain in "${DOMAIN_ARRAY[@]}"; do
                    printf "  - ${GREEN}${domain}${NC}\n"
                done
                printf "\n"

                read -p "Are these domains correct? (y/n): " confirm
                if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
                    break
                fi
            done

            # Update .env file and restart
            if ! update_env_var "PRIVATE_EMAIL_DOMAINS" "$new_domains"; then
                printf "${RED}Failed to update configuration.${NC}\n"
                exit 1
            fi

            printf "${GREEN}Email server configuration updated${NC}\n"

            printf "\n${YELLOW}Warning: Docker containers need to be restarted to apply these changes.${NC}\n"
            read -p "Restart now? (y/n): " restart_confirm

            if [ "$restart_confirm" != "y" ] && [ "$restart_confirm" != "Y" ]; then
                printf "${YELLOW}Please restart manually to apply the changes.${NC}\n"
                exit 0
            fi

            if ! handle_restart; then
                printf "${RED}Failed to restart services.${NC}\n"
                exit 1
            fi

            # Print success message
            printf "\n"
            print_success_box "The email server is now successfully configured!"

            # Print next steps
            printf "\n"
            printf "To test the email server:\n"
            printf "   a. Log in to your AliasVault account\n"
            printf "   b. Create a new alias using one of your configured private domains\n"
            printf "   c. Send a test email from an external email service (e.g., Gmail)\n"
            printf "   d. Check if the email appears in your AliasVault inbox\n"
            printf "\n"
            printf "If emails don't arrive, please verify:\n"
            printf "   > DNS MX records are correctly configured\n"
            printf "   > Your server's firewall allows incoming traffic on port 25 and 587\n"
            printf "   > Your ISP/hosting provider doesn't block SMTP traffic\n"
            printf "\n"
            ;;
        2)
            printf "\n${YELLOW}Warning: Docker containers need to be restarted after disabling the email server.${NC}\n"
            read -p "Continue with disable and restart? (y/n): " disable_confirm

            if [ "$disable_confirm" != "y" ] && [ "$disable_confirm" != "Y" ]; then
                printf "${YELLOW}Configuration cancelled.${NC}\n"
                exit 0
            fi

            # Disable email server
            if ! update_env_var "PRIVATE_EMAIL_DOMAINS" ""; then
                printf "${RED}Failed to update configuration.${NC}\n"
                exit 1
            fi

            if ! handle_restart; then
                printf "${RED}Failed to restart services.${NC}\n"
                exit 1
            fi

            # Print success message
            printf "\n"
            print_success_box "The email server has been disabled successfully!"
            ;;
        3)
            printf "${YELLOW}Email configuration cancelled.${NC}\n"
            exit 0
            ;;
        *)
            printf "${RED}Invalid option selected.${NC}\n"
            exit 1
            ;;
    esac

    # Remove the trap before normal exit
    trap - INT TERM
}

# Function to configure Let's Encrypt
configure_letsencrypt() {
    printf "${CYAN}> Configuring Let's Encrypt SSL certificate...${NC}\n"

    # Check if hostname is localhost
    if [ "$CURRENT_HOSTNAME" = "localhost" ]; then
        printf "${RED}Error: Let's Encrypt certificates cannot be issued for 'localhost'.${NC}\n"
        printf "${YELLOW}Please configure a valid publically resolvable domain name (e.g. mydomain.com) before setting up Let's Encrypt.${NC}\n"
        exit 1
    fi

    # Check if hostname is a valid domain
    if ! [[ "$CURRENT_HOSTNAME" =~ \.[a-zA-Z]{2,}$ ]]; then
        printf "${RED}Error: Invalid hostname '${CURRENT_HOSTNAME}'.${NC}\n"
        printf "${YELLOW}Please configure a valid publically resolvable domain name (e.g. mydomain.com) before setting up Let's Encrypt.${NC}\n"
        exit 1
    fi

    # Verify DNS is properly configured
    printf "\n${YELLOW}Important: Before proceeding, ensure that:${NC}\n"
    printf "1. AliasVault is currently running and accessible at ${CYAN}https://${CURRENT_HOSTNAME}${NC}\n"
    printf "2. Your domain (${CYAN}${CURRENT_HOSTNAME}${NC}) is externally resolvable to this server's IP address\n"
    printf "3. Ports 80 and 443 are open and accessible from the internet\n"
    printf "\n"

    read -p "Have you completed these steps? [y/N]: " REPLY
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        printf "${YELLOW}> Let's Encrypt configuration cancelled.${NC}\n"
        exit 0
    fi

    # Get contact email for Let's Encrypt
    SUPPORT_EMAIL=$(grep "^SUPPORT_EMAIL=" "$ENV_FILE" | cut -d '=' -f2)
    LETSENCRYPT_EMAIL=""

    while true; do
        printf "\nPlease enter a valid email address that will be used for Let's Encrypt certificate notifications:\n"
        read -p "Email: " LETSENCRYPT_EMAIL
        if [[ "$LETSENCRYPT_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
            printf "Confirm using ${CYAN}${LETSENCRYPT_EMAIL}${NC} for Let's Encrypt notifications? [y/N] "
            read REPLY
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                break
            fi
        else
            printf "${RED}Invalid email format. Please try again.${NC}\n"
        fi
    done

    # Create certbot directories
    printf "${CYAN}> Creating Let's Encrypt directories...${NC}\n"
    mkdir -p ./certificates/letsencrypt/www

    # Get absolute path for certificates directory for the docker bind mounts
    CERTIFICATES_DIR=$(realpath ./certificates)

    # Request certificate using a temporary certbot container
    printf "${CYAN}> Requesting Let's Encrypt certificate...${NC}\n"
    docker run --rm \
        -v "${CERTIFICATES_DIR}/letsencrypt:/etc/letsencrypt:rw" \
        -v "${CERTIFICATES_DIR}/letsencrypt/www:/var/www/certbot:rw" \
        certbot/certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email "$LETSENCRYPT_EMAIL" \
        --agree-tos \
        --no-eff-email \
        --non-interactive \
        --domains ${CURRENT_HOSTNAME} \
        --force-renewal

    if [ $? -ne 0 ]; then
        printf "${RED}Failed to obtain Let's Encrypt certificate.${NC}\n"
        exit 1
    fi

    # Fix permissions on Let's Encrypt directories and files
    sudo chmod -R 755 ./certificates/letsencrypt

    # Ensure private keys remain secure
    sudo find ./certificates/letsencrypt -type f -name "privkey*.pem" -exec chmod 600 {} \;
    sudo find ./certificates/letsencrypt -type f -name "fullchain*.pem" -exec chmod 644 {} \;

    # Update .env to indicate Let's Encrypt is enabled
    update_env_var "LETSENCRYPT_ENABLED" "true"

    # Restart only the reverse proxy with new configuration so it loads the new certificate
    printf "${CYAN}> Restarting reverse proxy with Let's Encrypt configuration...${NC}\n"
    eval "$(get_docker_compose_command) up -d reverse-proxy --force-recreate"

    # Starting certbot container to renew certificates automatically
    printf "${CYAN}> Starting new certbot container to renew certificates automatically...${NC}\n"
    eval "$(get_docker_compose_command) up -d certbot"

    # Print success message
    printf "\n"
    print_success_box "Let's Encrypt SSL certificate has been configured successfully!"
}

# Function to generate self-signed certificate
generate_self_signed_cert() {
    printf "${CYAN}> Generating new self-signed certificate...${NC}\n"

    # Disable Let's Encrypt
    update_env_var "LETSENCRYPT_ENABLED" "false"

    # Get current hostname from .env
    HOSTNAME_VALUE=$(grep "^HOSTNAME=" "$ENV_FILE" | cut -d '=' -f2)

    if [ -n "$HOSTNAME_VALUE" ] && [ "$HOSTNAME_VALUE" != "localhost" ]; then
        printf "${CYAN}> Using configured hostname: ${HOSTNAME_VALUE}${NC}\n"
        printf "${CYAN}> The certificate will include:${NC}\n"
        printf "  ${GREEN}Primary CN:${NC} ${HOSTNAME_VALUE}\n"
        printf "  ${GREEN}Alternative Names:${NC} localhost, 127.0.0.1\n\n"
    fi

    # Stop existing containers
    printf "${CYAN}> Stopping existing containers...${NC}\n"
    docker compose down

    # Remove existing certificates and hostname marker
    rm -f ./certificates/ssl/cert.pem ./certificates/ssl/key.pem ./certificates/ssl/.hostname_marker

    # Remove Let's Encrypt directories
    rm -rf ./certificates/letsencrypt

    # Start containers (which will generate new self-signed cert with hostname)
    printf "${CYAN}> Restarting services...${NC}\n"
    docker compose up -d

    # Print success message
    printf "\n"
    print_success_box "New self-signed certificate has been generated successfully!"
}

# New functions to handle container lifecycle:
handle_start() {
    printf "${CYAN}> Starting AliasVault containers...${NC}\n"
    eval "$(get_docker_compose_command) up -d"
    printf "${GREEN}> AliasVault containers started successfully.${NC}\n"
}

handle_stop() {
    printf "${CYAN}> Stopping AliasVault containers...${NC}\n"
    if ! docker compose ps --quiet 2>/dev/null | grep -q .; then
        printf "${YELLOW}> No containers are currently running.${NC}\n"
        exit 0
    fi

    eval "$(get_docker_compose_command) down"
    printf "${GREEN}> AliasVault containers stopped successfully.${NC}\n"
}

handle_restart() {
    printf "\n${CYAN}> Restarting AliasVault containers...${NC}\n"
    eval "$(get_docker_compose_command) down"
    eval "$(get_docker_compose_command) up -d"
    printf "${GREEN}> AliasVault containers restarted successfully.${NC}\n"
}

# Function to handle updates
handle_update() {
    printf "\n${YELLOW}+++ Checking for AliasVault updates +++${NC}\n"

    # First check for install.sh updates
    check_install_script_update || true

    # Check current version
    if ! grep -q "^ALIASVAULT_VERSION=" "$ENV_FILE"; then
        printf "${CYAN}> No version information found. Running first-time update check...${NC}\n"
        printf "\n"
        handle_install_version "latest"
        return
    fi

    current_version=$(grep "^ALIASVAULT_VERSION=" "$ENV_FILE" | cut -d '=' -f2)
    latest_version=$(get_latest_version) || {
        printf "${RED}> Failed to check for updates. Please try again later.${NC}\n"
        exit 1
    }

    if [ -z "$latest_version" ]; then
        printf "${RED}> Failed to check for updates. Please try again later.${NC}\n"
        exit 1
    fi

    if [ "$current_version" = "$latest_version" ]; then
        printf "\n"
        printf "You are already running the latest version of AliasVault (${current_version})!\n"
        exit 0
    fi

    if [ "$FORCE_YES" = true ]; then
        printf "${CYAN}> Updating AliasVault to the latest version (${latest_version})...${NC}\n"
        handle_install_version "$latest_version"
        printf "${GREEN}> Update completed successfully!${NC}\n"
        return
    fi

    printf "\n"
    printf "A new version of AliasVault is available (${latest_version})!\n"
    printf "\n"
    printf "${MAGENTA}Important:${NC}\n"
    printf "1. It's recommended to backup your database before updating (./install.sh db-export > backup.sql.gz)\n"
    printf "2. The update process will restart all containers\n"
    printf "\n"

    read -p "Would you like to continue with the update? [y/N]: " REPLY
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        printf "${YELLOW}> Update cancelled.${NC}\n"
        exit 0
    fi

    printf "${CYAN}> Updating AliasVault...${NC}\n"
    printf "\n"
    handle_install_version "$latest_version"
}

# Function to extract version
extract_version() {
    local file="$1"
    local version=$(head -n 2 "$file" | grep '@version' | cut -d' ' -f3)
    echo "$version"
}

# Function to compare semantic versions
compare_versions() {
    local version1="$1"
    local version2="$2"

    # Split versions into arrays
    IFS='.' read -ra v1_parts <<< "$version1"
    IFS='.' read -ra v2_parts <<< "$version2"

    # Compare each part numerically
    for i in {0..2}; do
        # Default to 0 if part doesn't exist
        local v1_part=${v1_parts[$i]:-0}
        local v2_part=${v2_parts[$i]:-0}

        # Compare numerically
        if [ "$v1_part" -gt "$v2_part" ]; then
            echo "1"  # version1 is greater
            return
        elif [ "$v1_part" -lt "$v2_part" ]; then
            echo "-1"  # version1 is lesser
            return
        fi
    done

    echo "0"  # versions are equal
}

# Function to check if install.sh needs updating
check_install_script_update() {
    printf "${CYAN}> Checking for install script updates...${NC}\n"

    # Get latest release version
    local latest_version=$(get_latest_version) || {
        printf "${RED}> Failed to check for install script updates. Continuing with current version.${NC}\n"
        return 1
    }

    if [ -z "$latest_version" ]; then
        printf "${RED}> Failed to check for install script updates. Continuing with current version.${NC}\n"
        return 1
    fi

    if ! curl -LsSf "${GITHUB_RAW_URL_REPO}/${latest_version}/install.sh" -o "install.sh.tmp"; then
        printf "${RED}> Failed to check for install script updates. Continuing with current version.${NC}\n"
        rm -f install.sh.tmp
        return 1
    fi

    # Get versions
    local current_version=$(extract_version "install.sh")
    local new_version=$(extract_version "install.sh.tmp")

    # Check if versions could be extracted
    if [ -z "$current_version" ] || [ -z "$new_version" ]; then
        printf "${YELLOW}> Could not determine script versions. Falling back to file comparison...${NC}\n"
        # Fall back to file comparison
        if ! cmp -s "install.sh" "install.sh.tmp"; then
            printf "${YELLOW}> Changes detected in install script.${NC}\n"
        else
            printf "${GREEN}> Install script is up to date.${NC}\n"
            rm -f install.sh.tmp
            return 0
        fi
    else
        # Compare versions using semver comparison
        if [ "$current_version" = "$new_version" ]; then
            printf "${GREEN}> Install script is up to date.${NC}\n"
            rm -f install.sh.tmp
            return 0
        else
            local compare_result=$(compare_versions "$current_version" "$new_version")

            if [ "$compare_result" -ge "0" ]; then
                printf "${GREEN}> Install script is up to date.${NC}\n"
                rm -f install.sh.tmp
                return 0
            fi
        fi
    fi

    # If we get here, an update is available
    if [ "$FORCE_YES" = true ]; then
        printf "${CYAN}> Updating install script...${NC}\n"
        cp "install.sh" "install.sh.backup"
        mv "install.sh.tmp" "install.sh"
        chmod +x "install.sh"
        printf "${GREEN}> Install script updated successfully.${NC}\n"
        printf "${GREEN}> Backup of previous version saved as install.sh.backup${NC}\n"
        exit 0
    fi

    printf "${YELLOW}> A new version of the install script is available (${new_version}).${NC}\n"
    printf "\n"
    printf "Would you like to update the install script? [Y/n]: "
    read -r reply

    if [[ ! $reply =~ ^[Nn]$ ]]; then
        # Create backup of current script
        cp "install.sh" "install.sh.backup"

        if mv "install.sh.tmp" "install.sh"; then
            chmod +x "install.sh"
            printf "${GREEN}> Install script updated successfully.${NC}\n"
            printf "${GREEN}> Backup of previous version saved as install.sh.backup${NC}\n"
            printf "${YELLOW}> Please run the update command again to continue with the update process.${NC}\n"
            exit 0
        else
            printf "${RED}> Failed to update install script. Continuing with current version.${NC}\n"
            # Restore from backup if update failed
            mv "install.sh.backup" "install.sh"
            rm -f install.sh.tmp
            return 1
        fi
    else
        printf "${YELLOW}> Continuing with current install script version.${NC}\n"
        rm -f install.sh.tmp
        return 0
    fi
}

# Function to perform the actual installation with specific version
handle_install_version() {
    local target_version="$1"

    # Validate semver format if a specific version is provided
    if [ -n "$target_version" ] && [ "$target_version" != "latest" ]; then
        if ! validate_semver "$target_version"; then
            printf "${RED}Error: You tried to install AliasVault with version '${target_version}' which is an incorrect value.${NC}\n"
            printf "Please check the command you executed and try again.${NC}\n"
            printf "\n"
            printf "The provided version must follow semantic versioning format (e.g., '0.0.1', '1.0.5') and match an existing version on GitHub.${NC}\n"
            printf "Alternatively, you can omit the version to install the latest version.${NC}\n"
            exit 1
        fi
    fi

    # If latest, get actual version number from GitHub API
    if [ "$target_version" = "latest" ]; then
        local actual_version=$(get_latest_version) || {
            printf "${RED}> Failed to get latest version. Please try again later.${NC}\n"
            exit 1
        }
        if [ -n "$actual_version" ]; then
            target_version="$actual_version"
        fi
    fi

    printf "\n${YELLOW}+++ Installing AliasVault ${target_version} +++${NC}\n"

    # Initialize workspace which makes sure all required directories and files exist
    initialize_workspace

    # Check if install script needs updating for this version
    check_install_script_version "$target_version"
    local check_result=$?

    if [ $check_result -eq 2 ]; then
        if [ "$FORCE_YES" = true ]; then
            printf "${CYAN}> Updating install script to match version ${target_version}...${NC}\n"
        else
            printf "${YELLOW}> A different version of the install script is required for installing version ${target_version}.${NC}\n"
            read -p "Would you like to self-update the install script before proceeding? [Y/n]: " reply
            if [[ $reply =~ ^[Nn]$ ]]; then
                printf "${YELLOW}> Continuing with current install script version.${NC}\n"
                rm -f install.sh.tmp
            fi
        fi

        if [ "$FORCE_YES" = true ] || [[ ! $reply =~ ^[Nn]$ ]]; then
            # Create backup of current script
            cp "install.sh" "install.sh.backup"

            if mv "install.sh.tmp" "install.sh"; then
                chmod +x "install.sh"
                printf "${GREEN}> Install script updated successfully.${NC}\n"
                printf "${GREEN}> Backup of previous version saved as install.sh.backup${NC}\n"
                printf "${YELLOW}> Please run the same install command again to continue with the installation.${NC}\n"
                exit 2
            else
                printf "${RED}> Failed to update install script. Continuing with current version.${NC}\n"
                mv "install.sh.backup" "install.sh"
                rm -f install.sh.tmp
            fi
        fi
    fi

    # Update docker-compose files with correct version so we pull the correct images
    if ! handle_docker_compose "$target_version"; then
        log_error "Failed to download docker-compose files"
        exit 1
    fi

    # Initialize environment
    check_and_populate_env

    # Set deployment mode to install to ensure container lifecycle uses install configuration
    set_deployment_mode "install"

    # Only generate admin password if not already set
    if [ ! -f "${SECRETS_DIR}/admin_password_hash" ] || [ -z "$(cat "${SECRETS_DIR}/admin_password_hash" 2>/dev/null)" ]; then
        generate_admin_password || { printf "${RED}> Failed to generate admin password${NC}\n"; exit 1; }
    fi

    # Pull images from GitHub Container Registry
    printf "\n${YELLOW}+++ Pulling Docker images +++${NC}\n"
    printf "${CYAN}ℹ Installing version: ${target_version}${NC}\n"

    images=(
        "${GITHUB_CONTAINER_REGISTRY}/postgres:${target_version}"
        "${GITHUB_CONTAINER_REGISTRY}/reverse-proxy:${target_version}"
        "${GITHUB_CONTAINER_REGISTRY}/api:${target_version}"
        "${GITHUB_CONTAINER_REGISTRY}/client:${target_version}"
        "${GITHUB_CONTAINER_REGISTRY}/admin:${target_version}"
        "${GITHUB_CONTAINER_REGISTRY}/smtp:${target_version}"
        "${GITHUB_CONTAINER_REGISTRY}/task-runner:${target_version}"
    )

    for image in "${images[@]}"; do
        if ! retry_command 3 5 enhanced_docker_pull "$image"; then
            log_warning "Failed to pull image: $image - continuing anyway"
        fi
    done

    printf "${GREEN}✓ Docker image pulling completed${NC}\n"

    # Save version to .env
    update_env_var "ALIASVAULT_VERSION" "$target_version"

    # Start containers
    printf "\n${YELLOW}+++ Starting services +++${NC}\n"

    if [ "$VERBOSE" = true ]; then
        printf "${CYAN}ℹ Starting Docker containers...${NC} "
        printf "\b${NC}\n"
        if ! docker compose up -d --force-recreate; then
            log_error "Failed to start Docker containers"
            exit 1
        fi
    else
        (
            docker compose up -d --force-recreate > /tmp/docker_start.log 2>&1 &
            START_PID=$!
            show_spinner $START_PID "Starting Docker containers "
            wait $START_PID
            START_EXIT_CODE=$?

            if [ $START_EXIT_CODE -ne 0 ]; then
                log_error "Failed to start Docker containers. Output:"
                cat /tmp/docker_start.log >&2
                exit 1
            fi

            rm -f /tmp/docker_start.log
        )
    fi
    printf "${GREEN}✓ Docker containers started successfully${NC}\n"

    # Check if AliasVault is actually responding before showing success
    if ! check_aliasvault_health; then
        printf "${YELLOW}Installation completed but AliasVault health check failed.${NC}\n"
        printf "${YELLOW}Please check the troubleshooting steps above.${NC}\n"
        exit 1
    fi

    # Clean up old Docker images
    cleanup_docker_images "$target_version"

    # Only show success message if we made it here without errors and health check passed
    print_install_success_message
}

# Function to handle development database configuration
configure_dev_database() {
    printf "${YELLOW}+++ Development Database Configuration +++${NC}\n"
    printf "\n"

    if [ ! -f "dockerfiles/docker-compose.dev.yml" ]; then
        printf "${RED}> The dockerfiles/docker-compose.dev.yml file is missing. This file is required to start the development database. Please checkout the full GitHub repository and try again.${NC}\n"
        return 1
    fi

    # Check if direct option was provided
    if [ -n "$COMMAND_ARG" ]; then
        case $COMMAND_ARG in
            1|start)
                if docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev ps --status running 2>/dev/null | grep -q postgres-dev; then
                    printf "${YELLOW}> Development database is already running.${NC}\n"
                else
                    printf "${CYAN}> Starting development database...${NC}\n"
                    docker compose -p aliasvault-dev -f dockerfiles/docker-compose.dev.yml up -d --wait --wait-timeout 60
                    printf "${GREEN}> Development database started successfully.${NC}\n"
                fi
                print_dev_db_details
                return
                ;;
            0|stop)
                if ! docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev ps --status running 2>/dev/null | grep -q postgres-dev; then
                    printf "${YELLOW}> Development database is already stopped.${NC}\n"
                else
                    printf "${CYAN}> Stopping development database...${NC}\n"
                    docker compose -p aliasvault-dev -f dockerfiles/docker-compose.dev.yml down
                    printf "${GREEN}> Development database stopped successfully.${NC}\n"
                fi
                return
                ;;
        esac
    fi

    # Check current status
    if docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev ps --status running 2>/dev/null | grep -q postgres-dev; then
        DEV_DB_STATUS="running"
    else
        DEV_DB_STATUS="stopped"
    fi

    printf "${CYAN}About Development Database:${NC}\n"
    printf "A separate PostgreSQL instance for development purposes that:\n"
    printf "  - Runs on port 5433 (to avoid conflicts)\n"
    printf "  - Uses simple credentials (password: 'password')\n"
    printf "  - Stores data separately from production\n"
    printf "\n"
    printf "${CYAN}Current Status:${NC}\n"
    if [ "$DEV_DB_STATUS" = "running" ]; then
        printf "Development Database: ${GREEN}Running${NC}\n"
    else
        printf "Development Database: ${YELLOW}Stopped${NC}\n"
    fi
    printf "\n"
    printf "Options:\n"
    printf "1) Start development database\n"
    printf "2) Stop development database\n"
    printf "3) View connection details\n"
    printf "4) Cancel\n"
    printf "\n"

    read -p "Select an option [1-4]: " dev_db_option

    case $dev_db_option in
        1)
            if [ "$DEV_DB_STATUS" = "running" ]; then
                printf "${YELLOW}> Development database is already running.${NC}\n"
            else
                printf "${CYAN}> Starting development database...${NC}\n"
                docker compose -p aliasvault-dev -f dockerfiles/docker-compose.dev.yml up -d --wait --wait-timeout 60
                printf "${GREEN}> Development database started successfully.${NC}\n"
            fi
            print_dev_db_details
            ;;
        2)
            if [ "$DEV_DB_STATUS" = "stopped" ]; then
                printf "${YELLOW}> Development database is already stopped.${NC}\n"
            else
                printf "${CYAN}> Stopping development database...${NC}\n"
                docker compose -p aliasvault-dev -f dockerfiles/docker-compose.dev.yml down
                printf "${GREEN}> Development database stopped successfully.${NC}\n"
            fi
            ;;
        3)
            print_dev_db_details
            ;;
        4)
            printf "${YELLOW}Configuration cancelled.${NC}\n"
            exit 0
            ;;
        *)
            printf "${RED}Invalid option selected.${NC}\n"
            exit 1
            ;;
    esac
}

# Function to print development database connection details
print_dev_db_details() {
    printf "\n"
    printf "${MAGENTA}=========================================================${NC}\n"
    printf "\n"
    printf "${CYAN}Development Database Connection Details:${NC}\n"
    printf "Host: localhost\n"
    printf "Port: 5433\n"
    printf "Database: aliasvault\n"
    printf "Username: aliasvault\n"
    printf "Password: password\n"
    printf "\n"
    printf "Connection string:\n"
    printf "Host=localhost;Port=5433;Database=aliasvault;Username=aliasvault;Password=password\n"
    printf "\n"
    printf "${MAGENTA}=========================================================${NC}\n"
}

# Function to set deployment mode in .env
set_deployment_mode() {
    local mode=$1
    if [ "$mode" != "build" ] && [ "$mode" != "install" ]; then
        printf "${RED}Invalid deployment mode: $mode${NC}\n"
        exit 1
    fi
    update_env_var "DEPLOYMENT_MODE" "$mode" &>/dev/null
}

# Function to handle database export
handle_db_export() {
    printf "${YELLOW}+++ Exporting Database +++${NC}\n" >&2

    # Check if output redirection is present
    if [ -t 1 ]; then
        printf "Usage: ./install.sh db-export [--dev] > backup.sql.gz\n" >&2
        printf "\n" >&2
        printf "Options:\n" >&2
        printf "  --dev    Export from development database\n" >&2
        printf "\n" >&2
        printf "Examples:\n" >&2
        printf "  ./install.sh db-export > my_backup_$(date +%Y%m%d).sql.gz\n" >&2
        printf "  ./install.sh db-export --dev > my_dev_backup_$(date +%Y%m%d).sql.gz\n" >&2
        printf "\n" >&2
        exit 1
    fi

    if [ "$DEV_DB" = true ]; then
        # Check if dev containers are running
        if ! docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev ps postgres-dev --quiet 2>/dev/null | grep -q .; then
            printf "${RED}Error: Development database container is not running. Start it first with: ./install.sh configure-dev-db${NC}\n" >&2
            exit 1
        fi

        # Check if postgres-dev container is healthy
        if ! docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev ps postgres-dev | grep -q "healthy"; then
            printf "${RED}Error: Development PostgreSQL container is not healthy. Please check the logs.${NC}\n" >&2
            exit 1
        fi

        printf "${CYAN}> Exporting development database...${NC}\n" >&2
        docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec postgres-dev pg_dump -U aliasvault aliasvault | gzip
    else
        # Production database export logic
        if ! docker compose ps --quiet 2>/dev/null | grep -q .; then
            printf "${RED}Error: AliasVault containers are not running. Start them first with: ./install.sh start${NC}\n" >&2
            exit 1
        fi

        if ! docker compose ps postgres | grep -q "healthy"; then
            printf "${RED}Error: PostgreSQL container is not healthy. Please check the logs with: docker compose logs postgres${NC}\n" >&2
            exit 1
        fi

        printf "${CYAN}> Exporting production database...${NC}\n" >&2
        docker compose exec postgres pg_dump -U aliasvault aliasvault | gzip
    fi

    if [ $? -eq 0 ]; then
        printf "${GREEN}> Database exported successfully.${NC}\n" >&2
    else
        printf "${RED}> Failed to export database.${NC}\n" >&2
        exit 1
    fi
}

# Function to handle database import
handle_db_import() {
    printf "${YELLOW}+++ Importing Database +++${NC}\n"

    # Check if containers are running
    if [ "$DEV_DB" = true ]; then
        if ! docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev ps postgres-dev | grep -q "healthy"; then
            printf "${RED}Error: Development PostgreSQL container is not healthy.${NC}\n"
            exit 1
        fi
    else
        if ! docker compose ps postgres | grep -q "healthy"; then
            printf "${RED}Error: PostgreSQL container is not healthy.${NC}\n"
            exit 1
        fi
    fi

    # Check if we're getting input from a pipe
    if [ -t 0 ]; then
        printf "Usage: ./install.sh db-import [--dev] < backup_file\n"
        printf "\n"
        printf "Options:\n"
        printf "  --dev    Import to development database\n"
        printf "\n"
        printf "Examples:\n"
        printf "  ./install.sh db-import < backup.sql.gz    # Import gzipped backup\n"
        printf "  ./install.sh db-import < backup.sql       # Import plain SQL backup\n"
        printf "  ./install.sh db-import --dev < backup.sql # Import to dev database\n"
        exit 1
    fi

    # Save stdin to file descriptor 3
    exec 3<&0

    printf "${RED}Warning: This will DELETE ALL EXISTING DATA in the "
    if [ "$DEV_DB" = true ]; then
        printf "development database"
    else
        printf "database"
    fi
    printf ".${NC}\n"

    if [ "$FORCE_YES" != true ]; then
        # Use /dev/tty to read from terminal even when stdin is redirected
        if [ -t 1 ] && [ -t 2 ] && [ -e /dev/tty ]; then
            # Temporarily switch stdin to tty for confirmation
            exec < /dev/tty
            read -p "Continue? [y/N]: " confirm
            # Switch back to original stdin
            exec 0<&3
            if [[ ! $confirm =~ ^[Yy]$ ]]; then
                exec 3<&-  # Close fd 3
                exit 1
            fi
        else
            printf "${RED}Error: Cannot read confirmation from terminal. Use -y flag to bypass confirmation.${NC}\n"
            exec 3<&-  # Close fd 3
            exit 1
        fi
    fi

    if [ "$DEV_DB" != true ]; then
        printf "${CYAN}> Stopping dependent services...${NC}\n"
        if [ "$VERBOSE" = true ]; then
            docker compose stop api admin task-runner smtp
        else
            docker compose stop api admin task-runner smtp > /dev/null 2>&1
        fi
    fi

    printf "${CYAN}> Importing "
    if [ "$DEV_DB" = true ]; then
        printf "development "
    fi
    printf "database...${NC}\n"

    # Create a temporary file to store the input
    temp_file=$(mktemp)
    cat <&3 > "$temp_file"  # Read from fd 3 instead of stdin
    exec 3<&-  # Close fd 3

    # Detect if the file is gzipped or plain SQL
    is_gzipped=false
    if gzip -t "$temp_file" 2>/dev/null; then
        is_gzipped=true
        printf "${CYAN}> Detected gzipped SQL backup${NC}\n"
    else
        # Check if it looks like SQL (basic validation)
        if head -n 10 "$temp_file" | grep -qE '(^--|^CREATE |^INSERT |^ALTER |^DROP |^\\\\connect|^SET |^COMMENT |^GRANT |^REVOKE )'; then
            printf "${CYAN}> Detected plain SQL backup${NC}\n"
        else
            printf "${RED}Error: Input is neither a valid gzip file nor a SQL file${NC}\n"
            rm "$temp_file"
            exit 1
        fi
    fi

    if [ "$DEV_DB" = true ]; then
        if [ "$VERBOSE" = true ]; then
            docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'aliasvault' AND pid <> pg_backend_pid();" && \
            docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault postgres -c "DROP DATABASE IF EXISTS aliasvault;" && \
            docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault postgres -c "CREATE DATABASE aliasvault OWNER aliasvault;" && \
            if [ "$is_gzipped" = true ]; then
                gunzip -c "$temp_file" | docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault aliasvault
            else
                cat "$temp_file" | docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault aliasvault
            fi
        else
            docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'aliasvault' AND pid <> pg_backend_pid();" > /dev/null 2>&1 && \
            docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault postgres -c "DROP DATABASE IF EXISTS aliasvault;" > /dev/null 2>&1 && \
            docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault postgres -c "CREATE DATABASE aliasvault OWNER aliasvault;" > /dev/null 2>&1 && \
            if [ "$is_gzipped" = true ]; then
                gunzip -c "$temp_file" | docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault aliasvault > /dev/null 2>&1
            else
                cat "$temp_file" | docker compose -f dockerfiles/docker-compose.dev.yml -p aliasvault-dev exec -T postgres-dev psql -U aliasvault aliasvault > /dev/null 2>&1
            fi
        fi
    else
        if [ "$VERBOSE" = true ]; then
            docker compose exec -T postgres psql -U aliasvault postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'aliasvault' AND pid <> pg_backend_pid();" && \
            docker compose exec -T postgres psql -U aliasvault postgres -c "DROP DATABASE IF EXISTS aliasvault;" && \
            docker compose exec -T postgres psql -U aliasvault postgres -c "CREATE DATABASE aliasvault OWNER aliasvault;" && \
            if [ "$is_gzipped" = true ]; then
                gunzip -c "$temp_file" | docker compose exec -T postgres psql -U aliasvault aliasvault
            else
                cat "$temp_file" | docker compose exec -T postgres psql -U aliasvault aliasvault
            fi
        else
            docker compose exec -T postgres psql -U aliasvault postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'aliasvault' AND pid <> pg_backend_pid();" > /dev/null 2>&1 && \
            docker compose exec -T postgres psql -U aliasvault postgres -c "DROP DATABASE IF EXISTS aliasvault;" > /dev/null 2>&1 && \
            docker compose exec -T postgres psql -U aliasvault postgres -c "CREATE DATABASE aliasvault OWNER aliasvault;" > /dev/null 2>&1 && \
            if [ "$is_gzipped" = true ]; then
                gunzip -c "$temp_file" | docker compose exec -T postgres psql -U aliasvault aliasvault > /dev/null 2>&1
            else
                cat "$temp_file" | docker compose exec -T postgres psql -U aliasvault aliasvault > /dev/null 2>&1
            fi
        fi
    fi

    import_status=$?
    rm "$temp_file"

    if [ $import_status -eq 0 ]; then
        printf "${GREEN}> Database imported successfully.${NC}\n"
        if [ "$DEV_DB" != true ]; then
            printf "${CYAN}> Starting services...${NC}\n"
            if [ "$VERBOSE" = true ]; then
                docker compose restart api admin task-runner smtp reverse-proxy
            else
                docker compose restart api admin task-runner smtp reverse-proxy > /dev/null 2>&1
            fi
        fi
    else
        printf "${RED}> Import failed. Please check that your backup file is valid.${NC}\n"
        exit 1
    fi
}

# Function to handle hostname configuration
handle_hostname_configuration() {
    printf "${YELLOW}+++ Hostname Configuration +++${NC}\n"
    printf "\n"

    # Check if AliasVault is installed
    if [ ! -f "docker-compose.yml" ]; then
        printf "${RED}Error: AliasVault must be installed first.${NC}\n"
        exit 1
    fi

    printf "The hostname is the domain name where your AliasVault server will be accessible.\n"
    printf "This hostname will be used for both Let's Encrypt and self-signed certificates.\n"
    printf "\n"

    # Get current hostname
    CURRENT_HOSTNAME=$(grep "^HOSTNAME=" "$ENV_FILE" | cut -d '=' -f2)
    printf "Current hostname: ${CYAN}${CURRENT_HOSTNAME}${NC}\n"
    printf "\n"

    # Ask for new hostname
    while true; do
        read -p "Enter new hostname (e.g. aliasvault.example.com): " NEW_HOSTNAME
        if [ -n "$NEW_HOSTNAME" ]; then
            break
        else
            printf "${YELLOW}> Hostname cannot be empty. Please enter a valid hostname.${NC}\n"
        fi
    done

    # Check if hostname changed
    HOSTNAME_CHANGED=false
    if [ "$CURRENT_HOSTNAME" != "$NEW_HOSTNAME" ]; then
        HOSTNAME_CHANGED=true
    fi

    # Update the hostname
    update_env_var "HOSTNAME" "$NEW_HOSTNAME"

    # If using self-signed cert and hostname changed, offer to regenerate
    if [ "$HOSTNAME_CHANGED" = true ]; then
        LETSENCRYPT_ENABLED=$(grep "^LETSENCRYPT_ENABLED=" "$ENV_FILE" | cut -d '=' -f2)
        if [ "$LETSENCRYPT_ENABLED" != "true" ]; then
            printf "\n${YELLOW}Hostname changed. The self-signed certificate needs to be regenerated.${NC}\n"
            read -p "Regenerate certificate now? (y/n): " REGEN_CERT
            if [ "$REGEN_CERT" = "y" ] || [ "$REGEN_CERT" = "Y" ]; then
                # Remove the hostname marker to force regeneration
                rm -f ./certificates/ssl/.hostname_marker

                printf "\n${YELLOW}Restarting services to regenerate certificate...${NC}\n"
                handle_restart
            else
                printf "${YELLOW}Please restart services manually to apply the new certificate.${NC}\n"
            fi
        else
            printf "\n${YELLOW}Note: You're using Let's Encrypt. Make sure the new hostname has proper DNS records.${NC}\n"
            printf "${YELLOW}You may need to reconfigure Let's Encrypt for the new hostname.${NC}\n"
        fi
    fi

    printf "\n"
    print_success_box "Hostname updated successfully to ${NEW_HOSTNAME}!"
}

# Function to handle IP logging configuration
handle_ip_logging_configuration() {
    # Get current IP logging setting
    CURRENT_SETTING=$(grep "^IP_LOGGING_ENABLED=" "$ENV_FILE" | cut -d '=' -f2)

    printf "${YELLOW}+++ Configure IP Address Logging +++${NC}\n"
    printf "\n"
    printf "Current setting: ${CYAN}${CURRENT_SETTING}${NC}\n"
    printf "\n"
    printf "1) Enable IP address logging\n"
    printf "2) Disable IP address logging\n"
    printf "\n"
    printf "Choose an option (1-2): "
    read -r choice

    case $choice in
        1)
            update_env_var "IP_LOGGING_ENABLED" "true"

            printf "\n${YELLOW}Warning: Docker containers need to be restarted to apply these changes.${NC}\n"
            read -p "Restart now? (y/n): " restart_confirm

            if [ "$restart_confirm" != "y" ] && [ "$restart_confirm" != "Y" ]; then
                printf "${YELLOW}Please restart manually to apply the changes.${NC}\n"
                exit 0
            fi

            handle_restart

            # Print success message
            printf "\n"
            print_success_box "IP address logging has been enabled!"
            ;;
        2)
            update_env_var "IP_LOGGING_ENABLED" "false"

            printf "\n${YELLOW}Warning: Docker containers need to be restarted to apply these changes.${NC}\n"
            read -p "Restart now? (y/n): " restart_confirm

            if [ "$restart_confirm" != "y" ] && [ "$restart_confirm" != "Y" ]; then
                printf "${YELLOW}Please restart manually to apply the changes.${NC}\n"
                exit 0
            fi

            handle_restart

            # Print success message
            printf "\n"
            print_success_box "IP address logging has been disabled!"
            ;;
        *)
            printf "${RED}Invalid option selected.${NC}\n"
            return 1
            ;;
    esac
}

check_and_populate_env() {
    printf "${CYAN}ℹ Checking .env values...${NC} ${GREEN}✓${NC}\n"

    # SUPPORT_EMAIL
    if ! grep -q "^SUPPORT_EMAIL=" "$ENV_FILE"; then
        read -p "Enter server admin support email address that is shown on contact page (optional, press Enter to skip): " SUPPORT_EMAIL
        update_env_var "SUPPORT_EMAIL" "$SUPPORT_EMAIL"
        printf "  Set SUPPORT_EMAIL\n"
    fi

    # JWT_KEY
    if [ ! -f "${SECRETS_DIR}/jwt_key" ] || [ -z "$(cat "${SECRETS_DIR}/jwt_key" 2>/dev/null)" ]; then
        JWT_KEY=$(openssl rand -base64 32)
        write_secret_to_file "jwt_key" "$JWT_KEY"
        printf "  Generated JWT_KEY\n"
    fi

    # DATA_PROTECTION_CERT_PASS
    if [ ! -f "${SECRETS_DIR}/data_protection_cert_pass" ] || [ -z "$(cat "${SECRETS_DIR}/data_protection_cert_pass" 2>/dev/null)" ]; then
        CERT_PASS=$(openssl rand -base64 32)
        write_secret_to_file "data_protection_cert_pass" "$CERT_PASS"
        printf "  Generated DATA_PROTECTION_CERT_PASS\n"
    fi

    # POSTGRES_PASSWORD
    if [ ! -f "${SECRETS_DIR}/postgres_password" ] || [ -z "$(cat "${SECRETS_DIR}/postgres_password" 2>/dev/null)" ]; then
        POSTGRES_PASS=$(openssl rand -base64 32)
        write_secret_to_file "postgres_password" "$POSTGRES_PASS"
        printf "  Generated POSTGRES_PASSWORD\n"
    fi

    # PRIVATE_EMAIL_DOMAINS
    if ! grep -q "^PRIVATE_EMAIL_DOMAINS=" "$ENV_FILE"; then
        update_env_var "PRIVATE_EMAIL_DOMAINS" ""
        printf "  Set PRIVATE_EMAIL_DOMAINS\n"
    fi

    # HTTP_PORT
    if ! grep -q "^HTTP_PORT=" "$ENV_FILE" || [ -z "$(grep "^HTTP_PORT=" "$ENV_FILE" | cut -d '=' -f2)" ]; then
        update_env_var "HTTP_PORT" "80"
        printf "  Set HTTP_PORT\n"
    fi

    # HTTPS_PORT
    if ! grep -q "^HTTPS_PORT=" "$ENV_FILE" || [ -z "$(grep "^HTTPS_PORT=" "$ENV_FILE" | cut -d '=' -f2)" ]; then
        update_env_var "HTTPS_PORT" "443"
        printf "  Set HTTPS_PORT\n"
    fi

    # SMTP_PORT
    if ! grep -q "^SMTP_PORT=" "$ENV_FILE" || [ -z "$(grep "^SMTP_PORT=" "$ENV_FILE" | cut -d '=' -f2)" ]; then
        update_env_var "SMTP_PORT" "25"
        printf "  Set SMTP_PORT\n"
    fi

    # SMTP_TLS_PORT
    if ! grep -q "^SMTP_TLS_PORT=" "$ENV_FILE" || [ -z "$(grep "^SMTP_TLS_PORT=" "$ENV_FILE" | cut -d '=' -f2)" ]; then
        update_env_var "SMTP_TLS_PORT" "587"
        printf "  Set SMTP_TLS_PORT\n"
    fi
}

main "$@"
