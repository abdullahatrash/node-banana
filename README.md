# Node Banana

> **Important note:** This is in early development, it probably has some issues. Use Chrome. For support or raising any issues join the [discord](https://discord.com/invite/89Nr6EKkTf). See the [docs](https://node-banana-docs.vercel.app/) for help, installation guides, and user guides.

Node Banana is node-based workflow application for generating images with Nano Banana Pro. Build image generation pipelines by connecting nodes on a visual canvas. Recent Fal and Replicate integration allows for complex image and video pipelines from any provider, but be aware this is still in testing. 

Built mainly with Opus 4.5.

![Node Banana Screenshot](public/node-banana.png)

## Features

- **Prompt to Workflow** - Generate complete workflows from natural language descriptions or choose from preset templates (Gemini only for now)
- **Visual Node Editor** - Drag-and-drop nodes onto an infinite canvas with pan and zoom
- **Image Annotation** - Full-screen editor with drawing tools (rectangles, circles, arrows, freehand, text)
- **AI Image Generation** - Generate images using Google Gemini models
- **Text Generation** - Generate text using Google Gemini or OpenAI models
- **Workflow Chaining** - Connect multiple nodes to create complex pipelines
- **Save/Load Workflows** - Export and import workflows as JSON files
- **Group Locking** - Lock node groups to skip them during execution

## Multi-Provider Support (Beta)

In addition to Google Gemini, Node Banana now supports:
- **Replicate** - Access thousands of open-source models
- **fal.ai** - Fast inference for image and video generation

Configure API keys in Project Settings to enable these providers.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Node Editor**: @xyflow/react (React Flow)
- **Canvas**: Konva.js / react-konva
- **State Management**: Zustand
- **Styling**: Tailwind CSS
- **AI**: Google Gemini API, OpenAI API, Replicate (Beta), fal.ai (Beta)

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended via Corepack)

### Environment Variables

Create a `.env.local` file in the root directory:

```env
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key      # Optional, for OpenAI LLM provider
REPLICATE_API_KEY=your_replicate_api_key  # Optional, beta
FAL_API_KEY=your_fal_api_key              # Optional, beta
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/node_banana
BETTER_AUTH_SECRET=change_this_to_a_long_random_secret
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
# Optional S3-backed asset storage
STORAGE_BACKEND=local                      # or "s3"
S3_BUCKET_NAME=your_bucket_name
S3_REGION=us-east-1
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

### Local Postgres (Docker)

Start local Postgres:

```bash
pnpm db:up
```

Generate and apply migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

Stop local Postgres:

```bash
pnpm db:down
```

### Installation

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build

```bash
pnpm build
pnpm start
```

## Example Workflows

The `/examples` directory contains some example workflow files from my personal projects. To try them:

1. Start the dev server with `pnpm dev`
2. Drag any `.json` file from the `/examples` folder into the browser window
3. Make sure you review each of the prompts before starting, these are fairly targetted to the examples. 

## Usage

1. **Add nodes** - Click the floating action bar to add nodes to the canvas
2. **Connect nodes** - Drag from output handles to input handles (matching types only)
3. **Configure nodes** - Adjust settings like model, aspect ratio, or drawing tools
4. **Run workflow** - Click the Run button to execute the pipeline
5. **Save/Load** - Use the header menu to save or load workflows

## Connection Rules

- **Image** handles connect to **Image** handles only
- **Text** handles connect to **Text** handles only
- Image inputs on generation nodes accept multiple connections
- Text inputs accept single connections

## Testing

Run the test suite with:

```bash
pnpm test              # Watch mode
pnpm test:run          # Single run
pnpm test:coverage     # With coverage report
```

## Contributions
PRs are welcome, please pull the latest changes from develop before creating a PR and make it to the develop branch, not master. Not that I'm primarily making this for my own workflows, if the PR conflicts with my own plans I'll politely reject it. If you want to collaborate, consider joining the Discord and we can hash something out. 

## License

MIT
