import os
import xml.sax.saxutils

def is_text_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            f.read(1024)
        return True
    except UnicodeDecodeError:
        return False

def generate_xml(root_dir, output_file):
    with open(output_file, 'w', encoding='utf-8') as outfile:
        outfile.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        outfile.write('<project>\n')

        includes = [
            os.path.join(root_dir, 'client', 'src'),
            os.path.join(root_dir, 'server', 'src'),
            os.path.join(root_dir, 'client', 'package.json'),
            os.path.join(root_dir, 'client', 'tsconfig.json'),
            os.path.join(root_dir, 'client', 'vite.config.ts'),
            os.path.join(root_dir, 'server', 'Cargo.toml'),
            os.path.join(root_dir, 'spacetime.toml'),
        ]

        excludes = [
            'node_modules', 'target', '.git', '.vscode', 'dist', 'build', 
            '.gemini', 'backup', 'generated' # Maybe include generated? User said "my code". Generated is usually not "my code". I'll exclude generated for now to keep it smaller, unless it's critical. Actually, generated types are critical for understanding. I'll INCLUDE generated.
        ]
        
        # Remove 'generated' from excludes if I want to include it. 
        # The user wants "all of my code". Generated code is technically part of the project but not written by them.
        # I will include it because it's needed to compile/run.
        excludes = [e for e in excludes if e != 'generated']

        for root, dirs, files in os.walk(root_dir):
            # Filter directories
            dirs[:] = [d for d in dirs if not any(ex in d for ex in excludes) and not d.startswith('.')]
            
            # Check if current root is within interesting paths
            # We want to include specific files in root, and everything in client/src and server/src
            
            for file in files:
                filepath = os.path.join(root, file)
                
                # Check if file should be included
                should_include = False
                
                # Explicit includes
                if filepath in includes:
                    should_include = True
                
                # Directory includes
                if not should_include:
                    for inc in includes:
                        if os.path.isdir(inc) and filepath.startswith(inc):
                            should_include = True
                            break
                
                if not should_include:
                    continue

                # Skip if binary or explicitly excluded extensions
                if file.endswith(('.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.mp4', '.mp3', '.wav', '.ogg', '.glb', '.gltf', '.fbx', '.bin', '.lock')):
                    continue

                if is_text_file(filepath):
                    rel_path = os.path.relpath(filepath, root_dir)
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            content = f.read()
                        
                        outfile.write(f'  <file path="{rel_path}">\n')
                        outfile.write(f'    <![CDATA[{content}]]>\n')
                        outfile.write('  </file>\n')
                        print(f"Included: {rel_path}")
                    except Exception as e:
                        print(f"Error reading {filepath}: {e}")

        outfile.write('</project>\n')

if __name__ == "__main__":
    root_dir = os.getcwd()
    output_file = r"C:\Users\gabeb\.gemini\antigravity\brain\d786e673-57a6-4e6c-9abb-a56a6929d368\project_code.xml"
    generate_xml(root_dir, output_file)
