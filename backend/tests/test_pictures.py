import httpx
import pytest
import respx

from app.config import get_settings
from app.services.pictures import find_picture
from validate import validator

PEXELS_KEY = "test-pexels-key"
PEXELS_ROUTE = {"host": "api.pexels.com", "path": "/v1/search"}
LARGE_URL = "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
PHOTO = {
    "id": 2014422,
    "url": "https://www.pexels.com/photo/2014422/",
    "photographer": "Joey Farina",
    "src": {"original": "https://images.pexels.com/photos/2014422/pexels-photo-2014422.jpeg", "large": LARGE_URL},
}


@pytest.fixture
def pexels_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PEXELS_API_KEY", PEXELS_KEY)
    get_settings.cache_clear()


@pytest.mark.usefixtures("pexels_key")
async def test_first_photo_becomes_picture_with_credit(respx_mock: respx.MockRouter) -> None:
    route = respx_mock.get(**PEXELS_ROUTE).mock(return_value=httpx.Response(200, json={"photos": [PHOTO]}))

    picture = await find_picture("  car engine  ")

    assert picture is not None
    assert picture.model_dump() == {"query": "car engine", "url": LARGE_URL, "credit": "Photo by Joey Farina on Pexels"}
    validator("Picture").validate(picture.model_dump())
    request = route.calls.last.request
    assert request.headers["authorization"] == PEXELS_KEY
    assert request.url.params["query"] == "car engine"
    assert request.url.params["per_page"] == "1"


@pytest.mark.usefixtures("pexels_key")
@pytest.mark.parametrize(
    "reply",
    [
        httpx.Response(200, json={"photos": []}),
        httpx.Response(500, json={"error": "down"}),
        httpx.Response(200, json={"unexpected": True}),
        httpx.ConnectTimeout("slow"),
    ],
    ids=["no-result", "server-error", "bad-body", "timeout"],
)
async def test_failures_give_no_picture(respx_mock: respx.MockRouter, reply: httpx.Response | Exception) -> None:
    route = respx_mock.get(**PEXELS_ROUTE)
    if isinstance(reply, Exception):
        route.mock(side_effect=reply)
    else:
        route.mock(return_value=reply)

    assert await find_picture("dyno test car") is None


async def test_missing_key_makes_no_request(respx_mock: respx.MockRouter) -> None:
    route = respx_mock.get(**PEXELS_ROUTE)

    assert await find_picture("car engine") is None
    assert not route.called


@pytest.mark.usefixtures("pexels_key")
@pytest.mark.parametrize("query", [None, "", "   "])
async def test_empty_query_makes_no_request(respx_mock: respx.MockRouter, query: str | None) -> None:
    route = respx_mock.get(**PEXELS_ROUTE)

    assert await find_picture(query) is None
    assert not route.called
