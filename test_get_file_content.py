from functions.get_file_content import get_file_content


print(get_file_content("calculator", "lorem.txt"))

result = get_file_content("calculator", "lorem.txt")
print(f"lorem.txt length: {len(result)}")
print(f"lorem.txt truncated: {'truncated' in result}", "\n")

print(get_file_content("calculator", "main.py"),"\n")
print(get_file_content("calculator", "pkg/calculator.py"),"\n")
print(get_file_content("calculator", "/bin/cat"),"\n")
print(get_file_content("calculator", "pkg/does_not_exist.py"),"\n")

print(get_file_content({"file_path": "main.py"}))
