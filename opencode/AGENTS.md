# AGENTS.md

1. You can work with projects located at /opt folder - for example:  

- /opt/project1
- /opt/project2

2. To run a using venv python module, python-based project, create a virtual environment at specific project - for example:  

- /opt/project1/.venv
- /opt/project2/.venv

3. Do not commit changes yourself, and do not stage them. Just update files on the disk and make required API calls.
4. When you create resources for testing, delete them yourself at the end of test.
5. Do not print env variables with auth credentials before running scripts to check their values.
6. You are running in a docker container, which has no system packages like 'docker' or 'sudo' available. There are custom aliases for agentic systems, which are located at /home/zeio/agents.zsh. These aliases are configured on the host OS inside which the docker system with your container is running. The opencode sessions is usually run using alias 'opencode' from this file. You can suggest updates to the script for improving user experience.
